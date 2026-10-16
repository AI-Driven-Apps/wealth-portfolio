// Fictional household for the Vercel demo (and local testing). Every
// instrument is invented and clearly named "Demo …" so nobody mistakes the
// numbers for a real fund's. Prices are a deterministic random walk, so the
// demo looks the same on every deploy and can be rolled forward daily.
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, fromDayNum, toDayNum, todayIST } from "@/lib/calc/dates";
import { expectedInstalments } from "@/lib/calc/sip";

export const SAMPLE_START = "2019-01-01";

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
  const arun = await mk("Arun (sample)");
  const meera = await mk("Meera (sample)");
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
  return { profiles: [arun, meera], trades: rows.length, sips };
}
