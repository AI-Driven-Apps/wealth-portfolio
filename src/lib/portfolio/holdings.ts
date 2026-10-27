import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildPosition, type LedgerTxn, type Position } from "@/lib/calc/fifo";
import { xirr } from "@/lib/calc/xirr";
import { todayIST } from "@/lib/calc/dates";
import type { Instrument } from "@/lib/db/schema";

export type AssetType = "stock" | "mf" | "etf";

export interface Holding {
  instrument: Instrument;
  position: Position;
  price: number | null;
  priceDate: string | null;
  prevClose: number | null;
  value: number;
  unrealized: number;
  unrealizedPct: number | null;
  dayChange: number | null;
  xirr: number | null;
  /** Equity / debt / gold... what the money is actually exposed to. */
  assetClass: string;
}

export function assetClassOf(i: Pick<Instrument, "type" | "underlyingClass">): string {
  if (i.type === "stock") return "equity";
  const u = i.underlyingClass ?? "other";
  return u === "liquid" ? "debt" : u;
}

/** Ledger rows for the given profiles, grouped by instrument. */
export async function loadLedger(profileIds: string[], types: AssetType[], instrumentId?: number) {
  if (!profileIds.length) return new Map<number, LedgerTxn[]>();
  const rows = await db.select({
    instrumentId: schema.txn.instrumentId, date: schema.txn.date, type: schema.txn.type,
    units: schema.txn.units, price: schema.txn.price, amount: schema.txn.amount, fees: schema.txn.fees,
  }).from(schema.txn)
    .innerJoin(schema.instrument, eq(schema.instrument.id, schema.txn.instrumentId))
    .where(and(
      inArray(schema.txn.profileId, profileIds),
      inArray(schema.instrument.type, types),
      instrumentId ? eq(schema.txn.instrumentId, instrumentId) : undefined,
    ))
    .orderBy(asc(schema.txn.date));
  const map = new Map<number, LedgerTxn[]>();
  for (const r of rows) {
    const list = map.get(r.instrumentId) ?? [];
    list.push({ date: r.date, type: r.type, units: Number(r.units), price: Number(r.price), amount: Number(r.amount), fees: Number(r.fees) });
    map.set(r.instrumentId, list);
  }
  return map;
}

/** Last two closes per instrument, for day change. */
async function lastTwoCloses(ids: number[]) {
  if (!ids.length) return new Map<number, { date: string; close: number }[]>();
  const rows = await db.execute<{ id: number; date: string; close: string }>(sql`
    select instrument_id as id, date::text as date, close from (
      select instrument_id, date, close, row_number() over (partition by instrument_id order by date desc) rn
      from price_history where instrument_id in ${sql.raw(`(${ids.map(Number).join(",")})`)}
    ) t where rn <= 2 order by instrument_id, date desc`);
  const m = new Map<number, { date: string; close: number }[]>();
  for (const r of rows) {
    const id = Number(r.id);
    m.set(id, [...(m.get(id) ?? []), { date: r.date, close: Number(r.close) }]);
  }
  return m;
}

export async function getHoldings(profileIds: string[], types: AssetType[], opts: { includeClosed?: boolean; instrumentId?: number } = {}): Promise<Holding[]> {
  const ledger = await loadLedger(profileIds, types, opts.instrumentId);
  const ids = [...ledger.keys()];
  if (!ids.length) return [];
  const instruments = await db.select().from(schema.instrument).where(inArray(schema.instrument.id, ids));
  const closes = await lastTwoCloses(ids);
  const today = todayIST();

  const out: Holding[] = [];
  for (const ins of instruments) {
    const pos = buildPosition(ledger.get(ins.id)!);
    if (!opts.includeClosed && pos.units === 0) continue;
    const hist = closes.get(ins.id) ?? [];
    // instrument.last_price may be fresher (live quote / today's NAV) than history.
    const lp = ins.lastPrice != null ? Number(ins.lastPrice) : hist[0]?.close ?? null;
    const lpDate = ins.lastPriceDate ?? hist[0]?.date ?? null;
    const prev = hist.find((h) => lpDate && h.date < lpDate)?.close ?? null;
    const value = lp != null ? pos.units * lp : pos.invested;
    const unrealized = value - pos.invested;
    const flows = [...pos.flows];
    if (value > 0) flows.push({ date: lpDate && lpDate > (pos.firstDate ?? "") ? lpDate : today, amount: value });
    out.push({
      instrument: ins, position: pos, price: lp, priceDate: lpDate, prevClose: prev,
      value, unrealized,
      unrealizedPct: pos.invested > 0 ? unrealized / pos.invested : null,
      dayChange: lp != null && prev != null ? pos.units * (lp - prev) : null,
      xirr: xirr(flows),
      assetClass: assetClassOf(ins),
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

export interface Totals {
  invested: number; value: number; unrealized: number; realized: number; dividends: number;
  dayChange: number; xirr: number | null; count: number;
}

export function totals(holdings: Holding[]): Totals {
  const flows = holdings.flatMap((h) => h.position.flows);
  const value = holdings.reduce((s, h) => s + h.value, 0);
  const lastDate = holdings.reduce((d, h) => (h.priceDate && h.priceDate > d ? h.priceDate : d), "");
  if (value > 0) flows.push({ date: lastDate || todayIST(), amount: value });
  return {
    invested: holdings.reduce((s, h) => s + h.position.invested, 0),
    value,
    unrealized: holdings.reduce((s, h) => s + h.unrealized, 0),
    realized: holdings.reduce((s, h) => s + h.position.realized, 0),
    dividends: holdings.reduce((s, h) => s + h.position.dividends, 0),
    dayChange: holdings.reduce((s, h) => s + (h.dayChange ?? 0), 0),
    xirr: xirr(flows),
    count: holdings.filter((h) => h.position.units > 0).length,
  };
}

export function groupBy(holdings: Holding[], key: (h: Holding) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const h of holdings) {
    if (h.value <= 0) continue;
    const k = key(h) || "Unclassified";
    m.set(k, (m.get(k) ?? 0) + h.value);
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].map(([name, value]) => ({ name, value, pct: total ? value / total : 0 })).sort((a, b) => b.value - a.value);
}

export async function priceSeries(instrumentId: number, from?: string) {
  const rows = await db.select({ date: schema.priceHistory.date, close: schema.priceHistory.close, adj: schema.priceHistory.adjClose })
    .from(schema.priceHistory)
    .where(and(eq(schema.priceHistory.instrumentId, instrumentId), from ? sql`date >= ${from}` : undefined))
    .orderBy(asc(schema.priceHistory.date));
  return rows.map((r) => ({ date: r.date, close: Number(r.close), adj: r.adj == null ? Number(r.close) : Number(r.adj) }));
}

export async function txnsFor(profileIds: string[], instrumentId: number) {
  if (!profileIds.length) return [];
  return db.select({ t: schema.txn, profile: schema.profile.name, account: schema.account.label })
    .from(schema.txn)
    .innerJoin(schema.profile, eq(schema.profile.id, schema.txn.profileId))
    .leftJoin(schema.account, eq(schema.account.id, schema.txn.accountId))
    .where(and(inArray(schema.txn.profileId, profileIds), eq(schema.txn.instrumentId, instrumentId)))
    .orderBy(desc(schema.txn.date));
}

export interface FiftyTwoWeek {
  high: number; highDate: string; low: number; lowDate: string; asOf: string;
}

/** 0 = at the 52-week low, 1 = at the 52-week high. Null when there's no range to place it in. */
export function rangePosition(price: number | null, w: FiftyTwoWeek | null): number | null {
  if (price == null || !w || w.high <= w.low) return null;
  return Math.min(1, Math.max(0, (price - w.low) / (w.high - w.low)));
}

export type Signal = "buy" | "sell" | "hold";

/** Within this fraction of the 52-week low/high counts as "near" it. */
const NEAR_EDGE = 0.05;

/** A simple mean-reversion read: near the low reads as a buy dip, near the high as a take-profit sell. */
export function fiftyTwoWeekSignal(price: number | null, w: FiftyTwoWeek | null): { signal: Signal; label: string } {
  if (price == null || !w || w.high <= w.low) return { signal: "hold", label: "Not enough history" };
  if (price <= w.low * (1 + NEAR_EDGE)) return { signal: "buy", label: "Near 52W low" };
  if (price >= w.high * (1 - NEAR_EDGE)) return { signal: "sell", label: "Near 52W high" };
  return { signal: "hold", label: "Mid-range" };
}

/** 52-week high/low close per instrument, from the trailing 365 days of stored history. */
export async function fiftyTwoWeekRange(ids: number[]): Promise<Map<number, FiftyTwoWeek>> {
  const out = new Map<number, FiftyTwoWeek>();
  if (!ids.length) return out;
  const list = sql.raw(`(${ids.map(Number).join(",")})`);
  const rows = await db.execute<{ id: number; d: string; hi: string; hid: string; lo: string; lod: string }>(sql`
    with last as (
      select instrument_id, max(date) d from price_history where instrument_id in ${list} group by instrument_id
    )
    select l.instrument_id as id, l.d::text as d, hi.close as hi, hi.date::text as hid, lo.close as lo, lo.date::text as lod
    from last l
    left join lateral (
      select close, date from price_history p
      where p.instrument_id = l.instrument_id and p.date > l.d - interval '365 days' and p.date <= l.d
      order by close desc, date desc limit 1
    ) hi on true
    left join lateral (
      select close, date from price_history p
      where p.instrument_id = l.instrument_id and p.date > l.d - interval '365 days' and p.date <= l.d
      order by close asc, date desc limit 1
    ) lo on true`);
  for (const r of rows) {
    if (r.hi == null || r.lo == null) continue;
    out.set(Number(r.id), { high: Number(r.hi), highDate: r.hid, low: Number(r.lo), lowDate: r.lod, asOf: r.d });
  }
  return out;
}

export interface Trailing { r1: number | null; r3: number | null; r5: number | null; asOf: string | null }

/**
 * 1/3/5-year returns from stored history (adjusted close where available).
 * 1 year is absolute; 3 and 5 years are CAGR, as fund factsheets show them.
 */
export async function trailingReturns(ids: number[]): Promise<Map<number, Trailing>> {
  const out = new Map<number, Trailing>();
  if (!ids.length) return out;
  const list = sql.raw(`(${ids.map(Number).join(",")})`);
  const rows = await db.execute<{ id: number; d0: string; c0: string; d1: string | null; c1: string | null; d3: string | null; c3: string | null; d5: string | null; c5: string | null; first: string }>(sql`
    with last as (
      select instrument_id, max(date) d, min(date) f from price_history where instrument_id in ${list} group by instrument_id
    )
    select l.instrument_id as id, l.d::text as d0, l.f::text as first,
      (select coalesce(adj_close, close) from price_history p where p.instrument_id = l.instrument_id and p.date = l.d) as c0,
      h1.date::text as d1, h1.c as c1, h3.date::text as d3, h3.c as c3, h5.date::text as d5, h5.c as c5
    from last l
    left join lateral (select date, coalesce(adj_close, close) c from price_history p where p.instrument_id = l.instrument_id and p.date <= l.d - interval '1 year' order by date desc limit 1) h1 on true
    left join lateral (select date, coalesce(adj_close, close) c from price_history p where p.instrument_id = l.instrument_id and p.date <= l.d - interval '3 years' order by date desc limit 1) h3 on true
    left join lateral (select date, coalesce(adj_close, close) c from price_history p where p.instrument_id = l.instrument_id and p.date <= l.d - interval '5 years' order by date desc limit 1) h5 on true`);
  const yrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365 * 86_400_000);
  for (const r of rows) {
    const c0 = Number(r.c0);
    // a point more than 10 days before the target means a gap in history, not a real start
    const ok = (d: string | null, target: number) => d != null && yrs(d, r.d0) <= target + 10 / 365;
    out.set(Number(r.id), {
      asOf: r.d0,
      r1: ok(r.d1, 1) ? c0 / Number(r.c1) - 1 : null,
      r3: ok(r.d3, 3) ? Math.pow(c0 / Number(r.c3), 1 / yrs(r.d3!, r.d0)) - 1 : null,
      r5: ok(r.d5, 5) ? Math.pow(c0 / Number(r.c5), 1 / yrs(r.d5!, r.d0)) - 1 : null,
    });
  }
  return out;
}
