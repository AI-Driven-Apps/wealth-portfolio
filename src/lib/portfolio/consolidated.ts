import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildPosition, type LedgerTxn } from "@/lib/calc/fifo";
import { fixedValue, maturityValue, KIND_CLASS, type FixedInput, type FixedValue } from "@/lib/calc/fixed";
import { amortise, loanStatus, outstandingOn, prepaymentImpact, type LoanEvent, type LoanInput, type LoanStatus, type ScheduleRow } from "@/lib/calc/loan";
import { addMonths, monthEnds, todayIST } from "@/lib/calc/dates";
import { getHoldings, loadLedger, totals, type AssetType, type Holding, type Totals } from "./holdings";
import type { FixedAsset, Loan, LoanEventRow } from "@/lib/db/schema";

// The consolidated view: market holdings + fixed income/alternatives − loans.
// Everything is derived from the ledger and the asset/loan terms on each request,
// so there is no snapshot to go stale (a household's data is small enough).

/** Who is asking: the profiles to sum and the modules they may see. */
export interface Scope { profileIds: string[]; features: Set<string> }

export function marketTypes(s: Scope): AssetType[] {
  const t: AssetType[] = [];
  if (s.features.has("mf") || s.features.has("sip") || s.features.has("fof")) t.push("mf");
  if (s.features.has("equity")) t.push("stock");
  if (s.features.has("etf")) t.push("etf");
  return t;
}

// ---------------------------------------------------------------- fixed assets

export interface FixedView {
  asset: FixedAsset;
  profileName: string;
  assetClass: string;
  now: FixedValue;
  maturity: number | null;
}

export const fixedInput = (a: FixedAsset): FixedInput => ({
  kind: a.kind, principal: Number(a.principal), ratePct: Number(a.ratePct), compounding: a.compounding, payout: a.payout,
  startDate: a.startDate, maturityDate: a.maturityDate, balance: a.balance == null ? null : Number(a.balance),
  balanceAsOf: a.balanceAsOf, closedOn: a.closedOn,
});

export async function getFixedAssets(profileIds: string[], today = todayIST()): Promise<FixedView[]> {
  if (!profileIds.length) return [];
  const rows = await db.select({ a: schema.fixedAsset, p: schema.profile.name }).from(schema.fixedAsset)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.fixedAsset.profileId))
    .where(inArray(schema.fixedAsset.profileId, profileIds)).orderBy(asc(schema.fixedAsset.maturityDate), asc(schema.fixedAsset.name));
  return rows.map(({ a, p }) => {
    const input = fixedInput(a);
    return { asset: a, profileName: p, assetClass: a.assetClass || KIND_CLASS[a.kind], now: fixedValue(input, today), maturity: maturityValue(input) };
  });
}

// ---------------------------------------------------------------- loans

export interface LoanView {
  loan: Loan;
  events: LoanEventRow[];
  profileName: string;
  input: LoanInput;
  evs: LoanEvent[];
  schedule: ScheduleRow[];
  status: LoanStatus;
  impact: ReturnType<typeof prepaymentImpact>;
}

export const loanInput = (l: Loan): LoanInput => ({
  principal: Number(l.principal), ratePct: Number(l.ratePct), tenureMonths: l.tenureMonths,
  emi: l.emi == null ? null : Number(l.emi), firstEmiDate: l.firstEmiDate,
});
export const loanEvents = (rows: LoanEventRow[]): LoanEvent[] => rows.map((e) => ({
  date: e.date, kind: e.kind, amount: e.amount == null ? null : Number(e.amount),
  ratePct: e.ratePct == null ? null : Number(e.ratePct), reduce: e.reduce === "emi" ? "emi" : "tenure",
}));

export async function getLoans(profileIds: string[], today = todayIST(), loanId?: string): Promise<LoanView[]> {
  if (!profileIds.length) return [];
  const rows = await db.select({ l: schema.loan, p: schema.profile.name }).from(schema.loan)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.loan.profileId))
    .where(inArray(schema.loan.profileId, profileIds)).orderBy(asc(schema.loan.firstEmiDate));
  const list = loanId ? rows.filter((r) => r.l.id === loanId) : rows;
  if (!list.length) return [];
  const events = await db.select().from(schema.loanEvent).where(inArray(schema.loanEvent.loanId, list.map((r) => r.l.id))).orderBy(asc(schema.loanEvent.date));
  return list.map(({ l, p }) => {
    const ev = events.filter((e) => e.loanId === l.id);
    const input = loanInput(l), evs = loanEvents(ev);
    const schedule = amortise(input, evs);
    const status = loanStatus(input, schedule, today);
    if (l.closedOn && l.closedOn <= today) status.outstanding = 0;
    return { loan: l, events: ev, profileName: p, input, evs, schedule, status, impact: prepaymentImpact(input, evs) };
  });
}

// ---------------------------------------------------------------- net worth now

export interface Consolidated {
  market: Holding[];          // open and closed, as getHoldings returns them
  marketTotals: Totals;
  fixed: FixedView[];
  loans: LoanView[];
  /** Asset class → rupees, across market holdings and fixed assets. */
  classes: Map<string, number>;
  assets: number;
  liabilities: number;
  net: number;
}

export async function consolidated(s: Scope, today = todayIST()): Promise<Consolidated> {
  const market = await getHoldings(s.profileIds, marketTypes(s), { includeClosed: true });
  const fixed = s.features.has("other") ? await getFixedAssets(s.profileIds, today) : [];
  const loans = s.features.has("loans") ? await getLoans(s.profileIds, today) : [];
  const classes = new Map<string, number>();
  const add = (c: string, v: number) => { if (v > 0) classes.set(c, (classes.get(c) ?? 0) + v); };
  for (const h of market) if (h.position.units > 0) add(h.assetClass, h.value);
  for (const f of fixed) add(f.assetClass, f.now.value);
  const assets = [...classes.values()].reduce((a, b) => a + b, 0);
  const liabilities = loans.reduce((a, l) => a + l.status.outstanding, 0);
  return { market, marketTotals: totals(market), fixed, loans, classes, assets, liabilities, net: assets - liabilities };
}

// ---------------------------------------------------------------- history

/** Month-end close per instrument ("YYYY-MM" → close of that month's last trading day). */
async function monthEndCloses(ids: number[], from: string): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  if (!ids.length) return out;
  const rows = await db.execute<{ id: number; ym: string; close: string }>(sql`
    select instrument_id as id, to_char(date, 'YYYY-MM') as ym, (array_agg(close order by date desc))[1] as close
    from price_history where instrument_id in ${sql.raw(`(${ids.map(Number).join(",")})`)} and date >= ${from}
    group by 1, 2`);
  for (const r of rows) {
    const id = Number(r.id);
    if (!out.has(id)) out.set(id, new Map());
    out.get(id)!.set(r.ym, Number(r.close));
  }
  return out;
}

/** Close for the month of `d`, or the latest month before it that has one. */
function closeAt(m: Map<string, number> | undefined, d: string, floor: string): number | null {
  if (!m) return null;
  for (let ym = d.slice(0, 7); ym >= floor; ym = addMonths(`${ym}-01`, -1).slice(0, 7)) {
    const v = m.get(ym);
    if (v != null) return v;
  }
  return null;
}

/** Market value per asset class at each date, from units held then × month-end price. */
export async function marketValueSeries(ledger: Map<number, LedgerTxn[]>, classOf: Map<number, string>, dates: string[]) {
  const ids = [...ledger.keys()];
  if (!dates.length) return [];
  const floor = addMonths(dates[0], -3).slice(0, 7);
  const closes = await monthEndCloses(ids, `${floor}-01`);
  return dates.map((d) => {
    const by = new Map<string, number>();
    for (const id of ids) {
      const txns = ledger.get(id)!.filter((t) => t.date <= d);
      if (!txns.length) continue;
      const units = buildPosition(txns).units;
      if (!units) continue;
      const px = closeAt(closes.get(id), d, floor);
      const c = classOf.get(id) ?? "other";
      by.set(c, (by.get(c) ?? 0) + units * (px ?? 0));
    }
    return { date: d, by };
  });
}

export interface TrendPoint { date: string; byClass: Record<string, number>; assets: number; liabilities: number; net: number }

/** Month-end net worth for the last `months` months (the final point is today, at current prices). */
export async function netWorthTrend(s: Scope, now: Consolidated, months = 60, today = todayIST()): Promise<TrendPoint[]> {
  const types = marketTypes(s);
  const ledger = await loadLedger(s.profileIds, types);
  const firstTxn = [...ledger.values()].flat().reduce((d, t) => (t.date < d ? t.date : d), today);
  const firstFixed = now.fixed.reduce((d, f) => (f.asset.startDate < d ? f.asset.startDate : d), today);
  const firstLoan = now.loans.reduce((d, l) => (l.loan.firstEmiDate < d ? l.loan.firstEmiDate : d), today);
  const earliest = [firstTxn, firstFixed, addMonths(firstLoan, -1)].sort()[0];
  const window = addMonths(today, -months);
  const dates = monthEnds(earliest > window ? earliest : window, today);
  const classOf = new Map(now.market.map((h) => [h.instrument.id, h.assetClass]));
  const market = await marketValueSeries(ledger, classOf, dates.slice(0, -1));
  const points: TrendPoint[] = [];
  dates.forEach((d, i) => {
    const by = new Map<string, number>();
    if (i < dates.length - 1) for (const [k, v] of market[i].by) by.set(k, v);
    else for (const h of now.market) if (h.position.units > 0) by.set(h.assetClass, (by.get(h.assetClass) ?? 0) + h.value);
    for (const f of now.fixed) {
      const v = fixedValue(fixedInput(f.asset), d).value;
      if (v > 0) by.set(f.assetClass, (by.get(f.assetClass) ?? 0) + v);
    }
    // A loan is owed from disbursal (a month before the first EMI) until paid off or closed.
    const liabilities = now.loans.reduce((a, l) => {
      if (d < addMonths(l.loan.firstEmiDate, -1) || (l.loan.closedOn && d >= l.loan.closedOn)) return a;
      return a + outstandingOn(l.input, l.schedule, d);
    }, 0);
    const byClass = Object.fromEntries([...by.entries()].filter(([, v]) => v > 0.5));
    const assets = Object.values(byClass).reduce((a, b) => a + b, 0);
    points.push({ date: d, byClass, assets, liabilities, net: assets - liabilities });
  });
  return points;
}
