// Fictional household for the Vercel demo (and local testing). Every
// instrument is invented and clearly named "Demo …" so nobody mistakes the
// numbers for a real fund's. Prices are a deterministic random walk, so the
// demo looks the same on every deploy and can be rolled forward daily.
import { and, eq, inArray, like, notLike, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, addMonths, fromDayNum, toDayNum, todayIST } from "@/lib/calc/dates";
import { expectedInstalments } from "@/lib/calc/sip";

export const SAMPLE_START = "2019-01-01";
export const SAMPLE_EMAIL_DOMAIN = "@sample.local";
export const SAMPLE_PROFILES = ["Arun (sample)", "Meera (sample)"] as const;

interface SampleInstrument {
  key: string;
  row: Omit<typeof schema.instrument.$inferInsert, "id">;
  start: number; drift: number; vol: number; seed: number;
  /** Corporate actions: the traded price divides by `factor` from `date` (split 1→2 = 2, bonus 1:2 = 1.5). */
  actions?: { date: string; factor: number }[];
}

export const SAMPLE_INSTRUMENTS: SampleInstrument[] = [
  { key: "bluechip", start: 32, drift: 0.12, vol: 0.15, seed: 11, row: { type: "mf", name: "Demo Bluechip Equity Fund - Direct Plan - Growth", amfiCode: "DEMO-101", amc: "Demo Mutual Fund", schemeCategory: "Equity Scheme - Large Cap Fund", plan: "direct", underlyingClass: "equity", capClass: "large" } },
  { key: "midcap", start: 41, drift: 0.17, vol: 0.21, seed: 102, row: { type: "mf", name: "Demo Midcap Opportunities Fund - Direct Plan - Growth", amfiCode: "DEMO-102", amc: "Demo Mutual Fund", schemeCategory: "Equity Scheme - Mid Cap Fund", plan: "direct", underlyingClass: "equity", capClass: "mid" } },
  { key: "flexi", start: 58, drift: 0.13, vol: 0.17, seed: 13, row: { type: "mf", name: "Demo Flexi Cap Fund - Regular Plan - Growth", amfiCode: "DEMO-103", amc: "Sample Asset Management", schemeCategory: "Equity Scheme - Flexi Cap Fund", plan: "regular", underlyingClass: "equity" } },
  { key: "debt", start: 24, drift: 0.07, vol: 0.015, seed: 14, row: { type: "mf", name: "Demo Short Duration Fund - Direct Plan - Growth", amfiCode: "DEMO-104", amc: "Demo Mutual Fund", schemeCategory: "Debt Scheme - Short Duration Fund", plan: "direct", underlyingClass: "debt" } },
  { key: "fof", start: 12, drift: 0.15, vol: 0.24, seed: 15, row: { type: "mf", name: "Demo Global Technology FoF - Direct Plan - Growth", amfiCode: "DEMO-105", amc: "Sample Asset Management", schemeCategory: "Other Scheme - FoF Overseas", plan: "direct", underlyingClass: "international", isFof: true } },
  { key: "bank", start: 980, drift: 0.11, vol: 0.24, seed: 21, row: { type: "stock", name: "Demo Bank Ltd", nseSymbol: "DEMOBANK", isin: "INDEMO000001", sector: "Financial Services", capClass: "large", underlyingClass: "equity" } },
  { key: "soft", start: 1450, drift: 0.14, vol: 0.27, seed: 22, actions: [{ date: "2023-07-14", factor: 2 }], row: { type: "stock", name: "Demo Software Ltd", nseSymbol: "DEMOSOFT", isin: "INDEMO000002", sector: "Technology", capClass: "large", underlyingClass: "equity" } },
  { key: "auto", start: 420, drift: 0.16, vol: 0.32, seed: 126, row: { type: "stock", name: "Demo Motors Ltd", nseSymbol: "DEMOAUTO", isin: "INDEMO000003", sector: "Consumer Cyclical", capClass: "mid", underlyingClass: "equity" } },
  { key: "pharma", start: 210, drift: 0.09, vol: 0.36, seed: 46, actions: [{ date: "2024-04-02", factor: 1.5 }], row: { type: "stock", name: "Demo Pharma Ltd", nseSymbol: "DEMOPHARMA", isin: "INDEMO000004", sector: "Healthcare", capClass: "small", underlyingClass: "equity" } },
  { key: "idx", start: 10800, drift: 0.115, vol: 0.16, seed: 31, row: { type: "index", name: "Demo Nifty 50 Index", nseSymbol: "DEMO-NIFTY50", yahooSymbol: "DEMO-NIFTY50", underlyingClass: "equity" } },
  { key: "niftyetf", start: 118, drift: 0.11, vol: 0.16, seed: 31, row: { type: "etf", name: "Demo Nifty 50 ETF", nseSymbol: "DEMONIFTY", isin: "INDEMO000101", amfiCode: "DEMO-201", amc: "Demo Mutual Fund", underlyingClass: "equity", trackedIndex: "Demo Nifty 50 Index", benchmarkYahoo: "DEMO-NIFTY50" } },
  { key: "goldetf", start: 36, drift: 0.1, vol: 0.13, seed: 115, row: { type: "etf", name: "Demo Gold ETF", nseSymbol: "DEMOGOLD", isin: "INDEMO000102", amfiCode: "DEMO-202", amc: "Demo Mutual Fund", underlyingClass: "gold" } },
];

// mulberry32: tiny deterministic PRNG
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const isWeekday = (iso: string) => { const d = new Date(iso + "T00:00:00Z").getUTCDay(); return d !== 0 && d !== 6; };

/** Business-day price path from SAMPLE_START to `until`. Same seed => same path, so extending is consistent. */
export function samplePath(si: SampleInstrument, until: string): { date: string; close: number; adj: number }[] {
  const r = rng(si.seed * 7919);
  const dt = 1 / 252;
  const out: { date: string; close: number; adj: number }[] = [];
  const total = (si.actions ?? []).reduce((f, a) => f * a.factor, 1);
  let p = si.start;
  // the Nifty ETF shares the index seed with a slightly lower drift, so it tracks with a small cost drag
  for (let d = toDayNum(SAMPLE_START); d <= toDayNum(until); d++) {
    const iso = fromDayNum(d);
    if (!isWeekday(iso)) continue;
    const z = gauss(r);
    p = p * Math.exp((si.drift - 0.5 * si.vol * si.vol) * dt + si.vol * Math.sqrt(dt) * z);
    // p is the economic value of one original share; the traded price drops at each split/bonus
    const applied = (si.actions ?? []).filter((a) => a.date <= iso).reduce((f, a) => f * a.factor, 1);
    out.push({ date: iso, close: Math.round((p / applied) * 10000) / 10000, adj: Math.round((p / total) * 10000) / 10000 });
  }
  return out;
}

export const isSampleInstrument = or(
  like(schema.instrument.amfiCode, "DEMO-%"),
  like(schema.instrument.nseSymbol, "DEMO%"),
);

async function upsertInstruments(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const si of SAMPLE_INSTRUMENTS) {
    const existing = await db.select({ id: schema.instrument.id }).from(schema.instrument)
      .where(si.row.amfiCode ? eq(schema.instrument.amfiCode, si.row.amfiCode) : and(eq(schema.instrument.type, si.row.type), eq(schema.instrument.nseSymbol, si.row.nseSymbol!)));
    if (existing[0]) { ids.set(si.key, existing[0].id); continue; }
    const [row] = await db.insert(schema.instrument).values(si.row).returning({ id: schema.instrument.id });
    ids.set(si.key, row.id);
  }
  return ids;
}

async function writePaths(ids: Map<string, number>, until: string): Promise<Map<string, { date: string; close: number; adj: number }[]>> {
  const paths = new Map<string, { date: string; close: number; adj: number }[]>();
  for (const si of SAMPLE_INSTRUMENTS) {
    const id = ids.get(si.key)!;
    const path = samplePath(si, until);
    paths.set(si.key, path);
    const [{ max }] = await db.execute<{ max: string | null }>(sql`select max(date)::text as max from price_history where instrument_id = ${id}`);
    const fresh = max ? path.filter((p) => p.date > max) : path;
    for (let i = 0; i < fresh.length; i += 2000) {
      await db.insert(schema.priceHistory)
        .values(fresh.slice(i, i + 2000).map((p) => ({ instrumentId: id, date: p.date, close: String(p.close), adjClose: String(p.adj) })))
        .onConflictDoNothing();
    }
    const last = path[path.length - 1];
    const lastNav = si.row.type === "etf" ? String(Math.round(last.close * 0.9985 * 10000) / 10000) : null;
    await db.update(schema.instrument)
      .set({ lastPrice: String(last.close), lastPriceDate: last.date, lastNav, lastNavDate: lastNav ? last.date : null, historySyncedAt: new Date() })
      .where(eq(schema.instrument.id, id));
  }
  return paths;
}

const priceOn = (path: { date: string; close: number }[], iso: string) => {
  let best = path[0];
  for (const p of path) { if (p.date <= iso) best = p; else break; }
  return best;
};

/** SIP instalments for active sample plans up to today (idempotent via dedup keys). */
async function writeSipInstalments(paths: Map<string, { date: string; close: number }[]>, ids: Map<string, number>, today: string) {
  const plans = await db.select().from(schema.sipPlan)
    .where(inArray(schema.sipPlan.instrumentId, [...ids.values()]));
  const keyById = new Map([...ids].map(([k, v]) => [v, k]));
  let n = 0;
  for (const plan of plans) {
    const path = paths.get(keyById.get(plan.instrumentId)!);
    if (!path) continue;
    const due = expectedInstalments({ amount: Number(plan.amount), dayOfMonth: plan.dayOfMonth, stepUpPct: Number(plan.stepUpPct), startDate: plan.startDate, endDate: plan.endDate }, today);
    const rows = due
      .filter((d) => !(plan.dayOfMonth === 5 && d.due === "2024-08-05")) // one deliberately missed instalment for the demo
      .map((d) => {
        const p = priceOn(path, d.due);
        const net = d.amount * (1 - 0.00005); // stamp duty 0.005%
        return {
          profileId: plan.profileId, accountId: plan.accountId, instrumentId: plan.instrumentId,
          date: p.date < d.due ? addDays(d.due, 0) : p.date, type: "sip" as const,
          units: (net / p.close).toFixed(6), price: String(p.close), amount: d.amount.toFixed(2), fees: "0",
          source: "sample" as const, dedupKey: `sample-sip:${plan.id}:${d.due}`,
        };
      });
    for (let i = 0; i < rows.length; i += 500) {
      const res = await db.insert(schema.txn).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: schema.txn.id });
      n += res.length;
    }
  }
  return n;
}

export async function extendSampleData(): Promise<number> {
  const ids = await upsertInstruments();
  const today = todayIST();
  const paths = await writePaths(ids, today);
  return writeSipInstalments(paths, ids, today);
}

/** One-off seed: fictional profiles, accounts, lump-sum and stock trades, SIP plans. */
export async function seedSampleHousehold(adminUserId: string, memberUserId: string | null) {
  const ids = await upsertInstruments();
  const today = todayIST();
  const paths = await writePaths(ids, today);

  const mk = async (name: string) => {
    const [ex] = await db.select().from(schema.profile).where(eq(schema.profile.name, name));
    if (ex) return ex.id;
    const [p] = await db.insert(schema.profile).values({ name, panLast4: "000D" }).returning({ id: schema.profile.id });
    return p.id;
  };
  const arun = await mk(SAMPLE_PROFILES[0]);
  const meera = await mk(SAMPLE_PROFILES[1]);
  await db.insert(schema.profileAccess).values([{ userId: adminUserId, profileId: arun }, { userId: adminUserId, profileId: meera }]).onConflictDoNothing();
  if (memberUserId) await db.insert(schema.profileAccess).values({ userId: memberUserId, profileId: meera, level: "manage" }).onConflictDoNothing();

  const acct = async (profileId: string, kind: "folio" | "demat", provider: string, ref: string) => {
    const [a] = await db.insert(schema.account).values({ profileId, kind, provider, ref, label: `${provider} ${ref}` })
      .onConflictDoUpdate({ target: [schema.account.profileId, schema.account.kind, schema.account.ref], set: { provider } })
      .returning({ id: schema.account.id });
    return a.id;
  };
  const aFolio = await acct(arun, "folio", "CAMS", "DEMO1234/56");
  const aFolio2 = await acct(arun, "folio", "KFINTECH", "DEMO7788");
  const aDemat = await acct(arun, "demat", "Dhan", "DEMO-1100");
  const mFolio = await acct(meera, "folio", "CAMS", "DEMO5678/90");
  const mDemat = await acct(meera, "demat", "Zerodha", "DEMO-2200");

  const plan = async (profileId: string, accountId: string, key: string, amount: number, day: number, start: string, stepUp = 0) => {
    const [ex] = await db.select().from(schema.sipPlan).where(and(eq(schema.sipPlan.profileId, profileId), eq(schema.sipPlan.instrumentId, ids.get(key)!)));
    if (ex) return;
    await db.insert(schema.sipPlan).values({ profileId, accountId, instrumentId: ids.get(key)!, amount: String(amount), dayOfMonth: day, startDate: start, stepUpPct: String(stepUp) });
  };
  await plan(arun, aFolio, "bluechip", 5000, 5, "2021-01-01", 10);
  await plan(arun, aFolio, "midcap", 3000, 12, "2022-06-01");
  await plan(meera, mFolio, "flexi", 4000, 20, "2022-01-01");

  type T = { profileId: string; accountId: string; key: string; date: string; type: "buy" | "sell" | "split" | "bonus" | "dividend_payout"; units?: number; amount?: number; fees?: number };
  const trades: T[] = [
    { profileId: arun, accountId: aFolio2, key: "flexi", date: "2020-03-24", type: "buy", amount: 100000 },
    { profileId: arun, accountId: aFolio, key: "debt", date: "2023-04-10", type: "buy", amount: 50000 },
    { profileId: arun, accountId: aFolio2, key: "fof", date: "2024-02-15", type: "buy", amount: 25000 },
    { profileId: arun, accountId: aFolio, key: "bluechip", date: "2024-11-18", type: "sell", units: 300 },
    { profileId: arun, accountId: aDemat, key: "bank", date: "2020-06-15", type: "buy", units: 40 },
    { profileId: arun, accountId: aDemat, key: "bank", date: "2022-09-12", type: "buy", units: 25 },
    { profileId: arun, accountId: aDemat, key: "bank", date: "2025-03-03", type: "sell", units: 30 },
    { profileId: arun, accountId: aDemat, key: "soft", date: "2021-02-01", type: "buy", units: 20 },
    { profileId: arun, accountId: aDemat, key: "soft", date: "2023-07-14", type: "split", units: 2 },
    { profileId: arun, accountId: aDemat, key: "soft", date: "2024-08-20", type: "dividend_payout", amount: 1200 },
    { profileId: arun, accountId: aDemat, key: "auto", date: "2023-01-09", type: "buy", units: 60 },
    { profileId: arun, accountId: aDemat, key: "niftyetf", date: "2021-05-03", type: "buy", units: 400 },
    { profileId: arun, accountId: aDemat, key: "niftyetf", date: "2024-06-05", type: "buy", units: 150 },
    { profileId: arun, accountId: aDemat, key: "goldetf", date: "2022-11-21", type: "buy", units: 900 },
    { profileId: meera, accountId: mDemat, key: "pharma", date: "2022-03-28", type: "buy", units: 150 },
    { profileId: meera, accountId: mDemat, key: "pharma", date: "2024-04-02", type: "bonus", units: 75 },
    { profileId: meera, accountId: mDemat, key: "soft", date: "2024-10-07", type: "buy", units: 12 },
    { profileId: meera, accountId: mDemat, key: "goldetf", date: "2023-09-11", type: "buy", units: 500 },
  ];
  const rows = trades.map((t, i) => {
    const p = priceOn(paths.get(t.key)!, t.date);
    const isMf = SAMPLE_INSTRUMENTS.find((s) => s.key === t.key)!.row.type === "mf";
    let units = t.units ?? 0, amount = t.amount ?? 0, price = p.close, fees = 0;
    if (t.type === "buy" || t.type === "sell") {
      if (!units) units = amount / price;
      amount = units * price;
      fees = isMf ? 0 : Math.round(amount * 0.001 * 100) / 100; // ~brokerage + charges
    }
    if (t.type === "split" || t.type === "bonus") { price = 0; amount = 0; }
    if (t.type === "dividend_payout") { units = 0; price = 0; }
    return {
      profileId: t.profileId, accountId: t.accountId, instrumentId: ids.get(t.key)!, date: p.date, type: t.type,
      units: units.toFixed(6), price: price.toFixed(4), amount: amount.toFixed(2), fees: fees.toFixed(2),
      source: "sample" as const, dedupKey: `sample-trade:${i}`,
    };
  });
  await db.insert(schema.txn).values(rows).onConflictDoNothing();
  const sips = await writeSipInstalments(paths, ids, today);
  const disclosureLines = await seedDisclosures(ids, today);
  await seedFixedAndLoans(arun, meera);
  return { profiles: [arun, meera], trades: rows.length, sips, disclosureLines };
}

// ---------------------------------------------------------------- phases 4–6 sample data

/** Fictional companies that appear only inside the demo funds' disclosures. */
const EXTRA_STOCKS = [
  { key: "steel", name: "Demo Steel Ltd", isin: "INDEMO000005", sector: "Basic Materials", cap: "large" },
  { key: "cement", name: "Demo Cement Ltd", isin: "INDEMO000006", sector: "Basic Materials", cap: "large" },
  { key: "telecom", name: "Demo Telecom Ltd", isin: "INDEMO000007", sector: "Communication Services", cap: "large" },
  { key: "power", name: "Demo Power Ltd", isin: "INDEMO000008", sector: "Utilities", cap: "mid" },
  { key: "finance", name: "Demo Finance Ltd", isin: "INDEMO000009", sector: "Financial Services", cap: "mid" },
  { key: "infra", name: "Demo Infra Ltd", isin: "INDEMO000010", sector: "Industrials", cap: "mid" },
  { key: "chem", name: "Demo Chemicals Ltd", isin: "INDEMO000011", sector: "Basic Materials", cap: "small" },
  { key: "retail", name: "Demo Retail Ltd", isin: "INDEMO000012", sector: "Consumer Defensive", cap: "small" },
] as const;

type Line = [key: string, weight: number] | [name: string, weight: number, kind: "debt" | "cash" | "foreign_equity" | "fund", sector?: string];
const DISCLOSURES: Record<string, Line[]> = {
  bluechip: [["bank", 18], ["soft", 16], ["steel", 13], ["cement", 12], ["telecom", 11], ["power", 8], ["finance", 7], ["auto", 6], ["infra", 5], ["TREPS", 4, "cash"]],
  midcap: [["auto", 15], ["power", 14], ["finance", 13], ["infra", 12], ["chem", 10], ["retail", 9], ["pharma", 8], ["soft", 6], ["bank", 5], ["TREPS", 8, "cash"]],
  flexi: [["bank", 14], ["soft", 13], ["auto", 10], ["telecom", 9], ["finance", 8], ["retail", 8], ["chem", 7], ["pharma", 7], ["steel", 6], ["infra", 6], ["Demo 7.10% GOI 2034", 4, "debt"], ["TREPS", 8, "cash"]],
  debt: [["Demo 7.10% GOI 2034", 40, "debt"], ["Demo Housing Finance NCD 2028", 25, "debt"], ["Demo Bank CD Mar 2027", 20, "debt"], ["Demo 364-day T-Bill", 10, "debt"], ["TREPS", 5, "cash"]],
  niftyetf: [["bank", 20], ["soft", 18], ["steel", 14], ["cement", 13], ["telecom", 13], ["power", 8], ["finance", 7], ["auto", 7]],
  fof: [["Demo US Technology Equity Fund", 97, "fund"], ["TREPS", 3, "cash"]],
  usfund: [["Demo Cloud Inc", 22, "foreign_equity", "Technology"], ["Demo Chips Corp", 20, "foreign_equity", "Technology"], ["Demo Search Inc", 18, "foreign_equity", "Communication Services"], ["Demo Phones Inc", 16, "foreign_equity", "Technology"], ["Demo Social Inc", 14, "foreign_equity", "Communication Services"], ["Cash & equivalents", 10, "cash"]],
};

async function seedDisclosures(ids: Map<string, number>, today: string) {
  const all = new Map(ids);
  for (const x of EXTRA_STOCKS) {
    const [ex] = await db.select({ id: schema.instrument.id }).from(schema.instrument).where(and(eq(schema.instrument.type, "stock"), eq(schema.instrument.isin, x.isin)));
    all.set(x.key, ex?.id ?? (await db.insert(schema.instrument).values({ type: "stock", name: x.name, isin: x.isin, sector: x.sector, capClass: x.cap, underlyingClass: "equity" }).returning({ id: schema.instrument.id }))[0].id);
  }
  // The FoF's underlying fund: held by nobody directly, so it has no prices.
  const [us] = await db.select({ id: schema.instrument.id }).from(schema.instrument).where(eq(schema.instrument.amfiCode, "DEMO-301"));
  all.set("usfund", us?.id ?? (await db.insert(schema.instrument).values({ type: "mf", name: "Demo US Technology Equity Fund - Direct Plan - Growth", amfiCode: "DEMO-301", amc: "Sample Asset Management", schemeCategory: "Other Scheme - FoF Overseas", plan: "direct", underlyingClass: "international" }).returning({ id: schema.instrument.id }))[0].id);

  const month = addMonths(today, -1).slice(0, 7) + "-01";
  const funds = Object.keys(DISCLOSURES).map((k) => all.get(k)!);
  await db.delete(schema.fundHolding).where(inArray(schema.fundHolding.fundId, funds));
  const rows = Object.entries(DISCLOSURES).flatMap(([fund, lines]) => lines.map((l) => {
    const known = l.length === 2 ? EXTRA_STOCKS.find((x) => x.key === l[0]) ?? SAMPLE_INSTRUMENTS.find((x) => x.key === l[0]) : undefined;
    if (l.length === 2) {
      const name = known ? ("row" in known ? known.row.name : known.name) : l[0];
      return { fundId: all.get(fund)!, asOfMonth: month, holdingInstrumentId: all.get(l[0]) ?? null, name, isin: null, kind: "equity" as const, sector: null, weightPct: l[1].toFixed(4) };
    }
    const kind = l[2];
    return { fundId: all.get(fund)!, asOfMonth: month, holdingInstrumentId: kind === "fund" ? all.get("usfund")! : null, name: l[0], isin: null, kind, sector: l[3] ?? null, weightPct: l[1].toFixed(4) };
  }));
  await db.insert(schema.fundHolding).values(rows);
  return rows.length;
}

async function seedFixedAndLoans(arun: string, meera: string) {
  const fixed: (typeof schema.fixedAsset.$inferInsert)[] = [
    { profileId: arun, kind: "fd", name: "Demo Bank FD (3 years)", institution: "Demo Bank", principal: "200000", ratePct: "7.100", compounding: "quarterly", startDate: "2024-06-10", maturityDate: "2027-06-10" },
    { profileId: arun, kind: "rd", name: "Demo Bank RD", institution: "Demo Bank", principal: "5000", ratePct: "6.800", compounding: "quarterly", startDate: "2025-01-05", maturityDate: "2027-01-05" },
    { profileId: arun, kind: "ppf", name: "PPF account", institution: "Demo Post Office", principal: "0", ratePct: "7.100", compounding: "yearly", startDate: "2016-04-01", maturityDate: "2031-04-01", balance: "650000", balanceAsOf: "2026-04-01" },
    { profileId: arun, kind: "sgb", name: "Sovereign gold bond 2021", principal: "120000", ratePct: "0", compounding: "yearly", startDate: "2021-03-02", maturityDate: "2029-03-02", balance: "214000", balanceAsOf: "2026-09-30", notes: "value at today's gold price; the 2.5% coupon is paid out" },
    { profileId: arun, kind: "other", name: "Demo flat (estimated value)", principal: "4200000", ratePct: "5.000", compounding: "yearly", startDate: "2021-07-15", balance: "5200000", balanceAsOf: "2026-09-30", assetClass: "real_estate", notes: "the home the loan paid for; revalue occasionally" },
    { profileId: arun, kind: "cash", name: "Savings account", institution: "Demo Bank", principal: "0", ratePct: "3.000", compounding: "quarterly", startDate: "2019-01-01", balance: "150000", balanceAsOf: "2026-10-01" },
    { profileId: meera, kind: "fd", name: "Demo Co-op FD (1 year)", institution: "Demo Co-operative Bank", principal: "100000", ratePct: "7.250", compounding: "quarterly", startDate: "2025-11-20", maturityDate: "2026-11-20" },
    { profileId: meera, kind: "epf", name: "EPF", institution: "EPFO", principal: "0", ratePct: "8.250", compounding: "yearly", startDate: "2018-07-01", balance: "340000", balanceAsOf: "2026-03-31" },
  ];
  for (const f of fixed) {
    const [ex] = await db.select({ id: schema.fixedAsset.id }).from(schema.fixedAsset).where(and(eq(schema.fixedAsset.profileId, f.profileId), eq(schema.fixedAsset.name, f.name)));
    if (!ex) await db.insert(schema.fixedAsset).values(f);
  }
  const loans: { row: typeof schema.loan.$inferInsert; events: Omit<typeof schema.loanEvent.$inferInsert, "loanId">[] }[] = [
    { row: { profileId: arun, kind: "home", name: "Demo flat loan", lender: "Demo Housing Finance", principal: "3500000", ratePct: "8.600", tenureMonths: 240, firstEmiDate: "2021-08-05" },
      events: [{ date: "2023-02-01", kind: "rate_change", ratePct: "8.850", reduce: "tenure" }, { date: "2024-03-15", kind: "prepayment", amount: "300000", reduce: "tenure" }, { date: "2025-06-01", kind: "rate_change", ratePct: "8.400", reduce: "emi" }] },
    { row: { profileId: meera, kind: "car", name: "Demo hatchback", lender: "Demo Bank", principal: "600000", ratePct: "9.200", tenureMonths: 60, firstEmiDate: "2023-04-10" }, events: [] },
  ];
  for (const l of loans) {
    const [ex] = await db.select({ id: schema.loan.id }).from(schema.loan).where(and(eq(schema.loan.profileId, l.row.profileId), eq(schema.loan.name, l.row.name)));
    if (ex) continue;
    const [row] = await db.insert(schema.loan).values(l.row).returning({ id: schema.loan.id });
    if (l.events.length) await db.insert(schema.loanEvent).values(l.events.map((e) => ({ ...e, loanId: row.id })));
  }
  const targets: [string, string, number][] = [[arun, "equity", 60], [arun, "debt", 25], [arun, "gold", 15], [meera, "equity", 70], [meera, "debt", 20], [meera, "gold", 10]];
  await db.insert(schema.targetAllocation).values(targets.map(([profileId, assetClass, t]) => ({ profileId, assetClass, targetPct: t.toFixed(2) }))).onConflictDoNothing();
}

// ---------------------------------------------------------------- data-mode guards

const DEMO_INSTRUMENT = sql`(${schema.instrument.amfiCode} like 'DEMO-%' or ${schema.instrument.nseSymbol} like 'DEMO%' or ${schema.instrument.isin} like 'INDEMO%')`;

/** Anything that isn't the demo: a real login, or a transaction that didn't come from the seed. */
export async function realDataSummary(): Promise<string | null> {
  const users = await db.select({ email: schema.appUser.email }).from(schema.appUser).where(notLike(schema.appUser.email, `%${SAMPLE_EMAIL_DOMAIN}`)).limit(3);
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from txn where source <> 'sample'`);
  if (!users.length && !Number(n)) return null;
  return [users.length ? `logins ${users.map((u) => u.email.replace(/^(.).*(@.*)$/, "$1…$2")).join(", ")}` : "", Number(n) ? `${n} non-sample transactions` : ""].filter(Boolean).join(" and ");
}

export async function hasSampleData(): Promise<boolean> {
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from app_user where email like ${"%" + SAMPLE_EMAIL_DOMAIN}`);
  return Number(n) > 0;
}

/**
 * Removes the demo: its logins, its two profiles (their ledger, plans, deposits,
 * loans and targets cascade) and the fictional instruments nobody else holds.
 */
export async function removeSampleData() {
  const users = await db.delete(schema.appUser).where(like(schema.appUser.email, `%${SAMPLE_EMAIL_DOMAIN}`)).returning({ id: schema.appUser.id });
  const profiles = await db.delete(schema.profile).where(inArray(schema.profile.name, [...SAMPLE_PROFILES])).returning({ id: schema.profile.id });
  const instruments = await db.delete(schema.instrument).where(and(DEMO_INSTRUMENT,
    sql`${schema.instrument.id} not in (select instrument_id from txn union select instrument_id from sip_plan)`)).returning({ id: schema.instrument.id });
  return { users: users.length, profiles: profiles.length, instruments: instruments.length };
}

/** The demo logins (admin + member, sharing SAMPLE_PASSWORD) and the fictional household. */
export async function seedSample(password: string, hash: (pw: string) => Promise<string>, builtFeatures: string[]) {
  const user = async (email: string, name: string, role: "admin" | "member") => {
    const [ex] = await db.select().from(schema.appUser).where(eq(schema.appUser.email, email));
    if (ex) return ex.id;
    const [u] = await db.insert(schema.appUser).values({ email, name, role, passwordHash: await hash(password) }).returning({ id: schema.appUser.id });
    return u.id;
  };
  const admin = await user(`admin${SAMPLE_EMAIL_DOMAIN}`, "Arun (sample admin)", "admin");
  const member = await user(`meera${SAMPLE_EMAIL_DOMAIN}`, "Meera (sample member)", "member");
  for (const key of builtFeatures) {
    await db.insert(schema.userFeature).values({ userId: member, key, enabled: key !== "imports" }).onConflictDoNothing();
  }
  return seedSampleHousehold(admin, member);
}
