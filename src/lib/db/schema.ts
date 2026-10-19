import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, date, numeric, integer,
  jsonb, primaryKey, uniqueIndex, index, serial,
} from "drizzle-orm/pg-core";

// Money and units are NUMERIC, never float. Drizzle returns them as strings;
// convert at the edge with Number() only for display/maths on small sets.
const units = (name: string) => numeric(name, { precision: 20, scale: 6 });
const rupees = (name: string) => numeric(name, { precision: 18, scale: 2 });

export const roleEnum = pgEnum("role", ["admin", "member"]);
export const accessLevelEnum = pgEnum("access_level", ["view", "manage"]);
export const instrumentTypeEnum = pgEnum("instrument_type", ["stock", "mf", "etf", "index"]);
export const capClassEnum = pgEnum("cap_class", ["large", "mid", "small"]);
export const underlyingEnum = pgEnum("underlying_class", [
  "equity", "debt", "liquid", "hybrid", "gold", "silver", "international", "other",
]);
export const accountKindEnum = pgEnum("account_kind", ["folio", "demat"]);
export const txnTypeEnum = pgEnum("txn_type", [
  "buy", "sell", "sip", "switch_in", "switch_out",
  "dividend_payout", "dividend_reinvest", "bonus", "split",
]);
export const txnSourceEnum = pgEnum("txn_source", [
  "manual", "cas", "demat_cas", "tradebook", "contract_note", "sample",
  "spreadsheet", "fixed_assets", "loans", // spreadsheet imports; the last two only label import batches
]);

// ---------- users, sessions, profiles ----------

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("member"),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  refreshHash: text("refresh_hash").notNull(), // random per-session nonce (hashed); kept for future use
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const profile = pgTable("profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  panHash: text("pan_hash"),
  panLast4: text("pan_last4"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profileAccess = pgTable("profile_access", {
  userId: uuid("user_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  level: accessLevelEnum("level").notNull().default("manage"),
}, (t) => [primaryKey({ columns: [t.userId, t.profileId] })]);

// ---------- feature flags ----------

export const featureFlag = pgTable("feature_flag", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  enabled: boolean("enabled").notNull().default(false),
});

export const userFeature = pgTable("user_feature", {
  userId: uuid("user_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  key: text("key").notNull().references(() => featureFlag.key, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })]);

// ---------- market data ----------

export const instrument = pgTable("instrument", {
  id: serial("id").primaryKey(),
  type: instrumentTypeEnum("type").notNull(),
  name: text("name").notNull(),
  isin: text("isin"),
  nseSymbol: text("nse_symbol"),
  bseCode: text("bse_code"),
  amfiCode: text("amfi_code"),
  yahooSymbol: text("yahoo_symbol"),
  dhanSecurityId: text("dhan_security_id"),
  amc: text("amc"),
  schemeCategory: text("scheme_category"),
  plan: text("plan"), // direct | regular
  sector: text("sector"),
  capClass: capClassEnum("cap_class"),
  isFof: boolean("is_fof").notNull().default(false),
  underlyingClass: underlyingEnum("underlying_class"),
  trackedIndex: text("tracked_index"),
  benchmarkYahoo: text("benchmark_yahoo"),
  active: boolean("active").notNull().default(true),
  lastPrice: units("last_price"),
  lastPriceDate: date("last_price_date"),
  lastNav: units("last_nav"),           // ETFs: AMFI NAV, compared with market price
  lastNavDate: date("last_nav_date"),
  historySyncedAt: timestamp("history_synced_at", { withTimezone: true }),
  // NSE bhavcopy history has been loaded back to this date (see jobs/prices).
  priceHistoryFrom: date("price_history_from"),
}, (t) => [
  uniqueIndex("instrument_amfi_uq").on(t.amfiCode),
  uniqueIndex("instrument_nse_uq").on(t.type, t.nseSymbol),
  index("instrument_isin_idx").on(t.isin),
]);

export const priceHistory = pgTable("price_history", {
  instrumentId: integer("instrument_id").notNull().references(() => instrument.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  close: units("close").notNull(),      // traded price / NAV — used for valuation
  adjClose: units("adj_close"),          // split/dividend adjusted — used for returns
}, (t) => [primaryKey({ columns: [t.instrumentId, t.date] })]);

// A broker's own instrument code (HDFC Securities "3MINDLEQNR", ICICI Direct
// "INFTEC"…) → ISIN or instrument. Scoped per broker: codes aren't unique across
// brokers and can collide with NSE symbols. Filled from a broker's code list or
// learned when a code is matched by hand in the import preview.
export const instrumentAlias = pgTable("instrument_alias", {
  source: text("source").notNull(),     // brokerKey(): "HDFC Securities" -> "hdfc"
  code: text("code").notNull(),         // upper-case, as it appears in the tradebook
  isin: text("isin"),
  instrumentId: integer("instrument_id").references(() => instrument.id, { onDelete: "cascade" }),
  name: text("name"),
  origin: text("origin").notNull(),     // list | match
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.source, t.code] })]);

// ---------- holdings ledger ----------

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  kind: accountKindEnum("kind").notNull(),
  provider: text("provider").notNull(), // CAMS, KFINTECH, Dhan, Zerodha, CDSL...
  ref: text("ref").notNull(),           // folio number or demat id
  label: text("label"),
}, (t) => [uniqueIndex("account_uq").on(t.profileId, t.kind, t.ref)]);

export const importBatch = pgTable("import_batch", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => appUser.id, { onDelete: "set null" }),
  kind: txnSourceEnum("kind").notNull(),
  filename: text("filename"),
  stats: jsonb("stats").$type<Record<string, number>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const txn = pgTable("txn", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => account.id, { onDelete: "set null" }),
  instrumentId: integer("instrument_id").notNull().references(() => instrument.id),
  date: date("date").notNull(),
  type: txnTypeEnum("type").notNull(),
  units: units("units").notNull(),         // split: ratio (e.g. 5 for 1→5)
  price: units("price").notNull(),
  amount: rupees("amount").notNull(),      // always positive; direction from type
  fees: rupees("fees").notNull().default("0"),
  source: txnSourceEnum("source").notNull(),
  dedupKey: text("dedup_key").notNull(),
  importBatchId: uuid("import_batch_id").references(() => importBatch.id, { onDelete: "cascade" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("txn_dedup_uq").on(t.profileId, t.dedupKey),
  index("txn_profile_instr_idx").on(t.profileId, t.instrumentId, t.date),
]);

export const sipPlan = pgTable("sip_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => account.id, { onDelete: "set null" }),
  instrumentId: integer("instrument_id").notNull().references(() => instrument.id),
  amount: rupees("amount").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  stepUpPct: numeric("step_up_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  active: boolean("active").notNull().default(true),
});

// ---------- look-through (phase 4) ----------

export const holdingKindEnum = pgEnum("holding_kind", ["equity", "foreign_equity", "debt", "fund", "cash", "other"]);

/** One line of a fund's monthly portfolio disclosure. Replaced as a whole per (fund, month). */
export const fundHolding = pgTable("fund_holding", {
  id: serial("id").primaryKey(),
  fundId: integer("fund_id").notNull().references(() => instrument.id, { onDelete: "cascade" }),
  asOfMonth: date("as_of_month").notNull(), // first day of the disclosure month
  holdingInstrumentId: integer("holding_instrument_id").references(() => instrument.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  isin: text("isin"),
  kind: holdingKindEnum("kind").notNull(),
  sector: text("sector"),                   // as the AMC reports it; fallback when the stock has none
  weightPct: numeric("weight_pct", { precision: 9, scale: 4 }).notNull(),
}, (t) => [index("fund_holding_fund_idx").on(t.fundId, t.asOfMonth)]);

// ---------- fixed income, alternatives, loans (phase 5) ----------

export const fixedKindEnum = pgEnum("fixed_kind", ["fd", "rd", "bond", "ppf", "epf", "nps", "sgb", "gold", "reit", "cash", "other"]);
export const compoundingEnum = pgEnum("compounding", ["monthly", "quarterly", "half_yearly", "yearly", "simple"]);

export const fixedAsset = pgTable("fixed_asset", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  kind: fixedKindEnum("kind").notNull(),
  name: text("name").notNull(),
  institution: text("institution"),
  principal: rupees("principal").notNull(),            // RD: the monthly instalment
  ratePct: numeric("rate_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  compounding: compoundingEnum("compounding").notNull().default("quarterly"),
  payout: boolean("payout").notNull().default(false),  // interest paid out (payout FD, bonds, SGB coupon)
  startDate: date("start_date").notNull(),
  maturityDate: date("maturity_date"),
  balance: rupees("balance"),                           // known balance (EPF/PPF/NPS/gold/cash), grown at rate from balance_as_of
  balanceAsOf: date("balance_as_of"),
  assetClass: text("asset_class"),                      // overrides the kind's default class, e.g. NPS equity
  closedOn: date("closed_on"),
  notes: text("notes"),
  importBatchId: uuid("import_batch_id").references(() => importBatch.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loanKindEnum = pgEnum("loan_kind", ["home", "car", "personal", "education", "gold", "other"]);
export const loanEventKindEnum = pgEnum("loan_event_kind", ["prepayment", "rate_change"]);

export const loan = pgTable("loan", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  kind: loanKindEnum("kind").notNull(),
  name: text("name").notNull(),
  lender: text("lender"),
  principal: rupees("principal").notNull(),
  ratePct: numeric("rate_pct", { precision: 6, scale: 3 }).notNull(),
  tenureMonths: integer("tenure_months").notNull(),
  emi: rupees("emi"),                                   // null = computed from principal, rate, tenure
  firstEmiDate: date("first_emi_date").notNull(),
  closedOn: date("closed_on"),
  notes: text("notes"),
  importBatchId: uuid("import_batch_id").references(() => importBatch.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loanEvent = pgTable("loan_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loan.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  kind: loanEventKindEnum("kind").notNull(),
  amount: rupees("amount"),                              // prepayment
  ratePct: numeric("rate_pct", { precision: 6, scale: 3 }), // rate change
  reduce: text("reduce").notNull().default("tenure"),   // tenure | emi
  importBatchId: uuid("import_batch_id").references(() => importBatch.id, { onDelete: "cascade" }),
}, (t) => [index("loan_event_loan_idx").on(t.loanId, t.date)]);

// ---------- allocation targets and alerts (phase 6) ----------

export const targetAllocation = pgTable("target_allocation", {
  profileId: uuid("profile_id").notNull().references(() => profile.id, { onDelete: "cascade" }),
  assetClass: text("asset_class").notNull(),
  targetPct: numeric("target_pct", { precision: 5, scale: 2 }).notNull(),
  bandPct: numeric("band_pct", { precision: 5, scale: 2 }), // null = the admin's default band
}, (t) => [primaryKey({ columns: [t.profileId, t.assetClass] })]);

export const channelScopeEnum = pgEnum("channel_scope", ["global", "user"]);

export const notificationChannel = pgTable("notification_channel", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: channelScopeEnum("scope").notNull(),
  ownerUserId: uuid("owner_user_id").references(() => appUser.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  webhookEnc: text("webhook_enc").notNull(),            // AES-256-GCM; never sent to the browser
  webhookHint: text("webhook_hint").notNull(),          // last 4 of the token, for display
  enabled: boolean("enabled").notNull().default(true),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alertSubscription = pgTable("alert_subscription", {
  channelId: uuid("channel_id").notNull().references(() => notificationChannel.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [primaryKey({ columns: [t.channelId, t.alertType] })]);

/** One row per alert delivered, so re-running the alerts job never repeats a message. */
export const alertSent = pgTable("alert_sent", {
  id: serial("id").primaryKey(),
  channelId: uuid("channel_id").notNull().references(() => notificationChannel.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  key: text("key").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("alert_sent_uq").on(t.channelId, t.alertType, t.key)]);

// ---------- ops ----------

export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobRun = pgTable("job_run", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"), // running | ok | error
  detail: jsonb("detail"),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => appUser.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type Instrument = typeof instrument.$inferSelect;
export type Txn = typeof txn.$inferSelect;
export type AppUser = typeof appUser.$inferSelect;
export type FixedAsset = typeof fixedAsset.$inferSelect;
export type Loan = typeof loan.$inferSelect;
export type LoanEventRow = typeof loanEvent.$inferSelect;
