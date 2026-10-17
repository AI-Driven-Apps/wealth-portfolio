import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { asLumpSum, fdPriceAt, replay, seriesPriceAt, stoppedAfter, type ReplayResult } from "@/lib/calc/whatif";
import { maxDrawdown } from "@/lib/calc/returns";
import { xirr, type CashFlow } from "@/lib/calc/xirr";
import { monthEnds, todayIST } from "@/lib/calc/dates";
import { ensureHistory } from "@/lib/jobs";
import { getHoldings, loadLedger, priceSeries, totals, type AssetType, type Holding } from "./holdings";
import { marketValueSeries } from "./consolidated";
import type { Instrument } from "@/lib/db/schema";

export type Alternative =
  | { kind: "instrument"; id: number }
  | { kind: "fd"; ratePct: number }
  | { kind: "lumpsum" }
  | { kind: "stop"; date: string };

export interface WhatIfResult {
  holdings: Holding[];
  alt: Alternative;
  altInstrument: Instrument | null;
  actual: { invested: number; withdrawn: number; value: number; xirr: number | null; series: { date: string; value: number }[] };
  replay: ReplayResult;
  drawdown: { actual: number | null; alternative: number | null };
  firstDate: string;
}

/** Selection → holdings: one instrument id, or a whole product ("mf", "stock", "etf", "all"). */
export async function selectHoldings(profileIds: string[], types: AssetType[], sel: string): Promise<Holding[]> {
  const id = Number(sel);
  if (Number.isInteger(id) && id > 0) return getHoldings(profileIds, types, { includeClosed: true, instrumentId: id });
  const t = sel === "all" ? types : types.filter((x) => x === sel);
  return getHoldings(profileIds, t, { includeClosed: true });
}

const sum = (fl: CashFlow[], sign: 1 | -1) => fl.filter((f) => Math.sign(f.amount) === sign).reduce((s, f) => s + Math.abs(f.amount), 0);
const priceOf = (ins: Instrument, p: { close: number; adj: number }) => (ins.type === "mf" ? p.close : p.adj);

export async function runWhatIf(profileIds: string[], types: AssetType[], sel: string, alt: Alternative): Promise<WhatIfResult | null> {
  const holdings = (await selectHoldings(profileIds, types, sel)).filter((h) => h.position.flows.length);
  if (!holdings.length) return null;
  const today = todayIST();
  const flows = holdings.flatMap((h) => h.position.flows);
  const firstDate = flows.reduce((d, f) => (f.date < d ? f.date : d), today);
  const dates = monthEnds(firstDate, today);

  // Actual: what you really hold, valued month by month.
  const ledger = await loadLedger(profileIds, [...new Set(holdings.map((h) => h.instrument.type as AssetType))]);
  for (const k of [...ledger.keys()]) if (!holdings.some((h) => h.instrument.id === k)) ledger.delete(k);
  const mv = await marketValueSeries(ledger, new Map(holdings.map((h) => [h.instrument.id, "x"])), dates.slice(0, -1));
  const t = totals(holdings);
  const actualSeries = [...mv.map((p) => ({ date: p.date, value: p.by.get("x") ?? 0 })), { date: today, value: t.value }];

  let rep: ReplayResult;
  let altInstrument: Instrument | null = null;
  let altDrawdown: number | null = null;
  if (alt.kind === "instrument") {
    [altInstrument] = await db.select().from(schema.instrument).where(eq(schema.instrument.id, alt.id));
    if (!altInstrument) return null;
    try { await ensureHistory(alt.id, firstDate); } catch { /* replay what we have */ }
    const s = (await priceSeries(alt.id)).map((p) => ({ date: p.date, close: priceOf(altInstrument!, p) }));
    rep = replay(flows, seriesPriceAt(s), today, dates);
    altDrawdown = s.length ? maxDrawdown(s.filter((p) => p.date >= firstDate).map((p) => p.close)) : null;
  } else if (alt.kind === "fd") {
    rep = replay(flows, fdPriceAt(alt.ratePct, firstDate), today, dates);
    altDrawdown = 0;
  } else {
    // Same holdings, different timing: replay each into its own price history and add up.
    const parts: ReplayResult[] = [];
    for (const h of holdings) {
      const s = (await priceSeries(h.instrument.id)).map((p) => ({ date: p.date, close: priceOf(h.instrument, p) }));
      const f = alt.kind === "lumpsum" ? asLumpSum(h.position.flows) : stoppedAfter(h.position.flows, alt.date);
      parts.push(replay(f, seriesPriceAt(s), today, dates));
    }
    const all = parts.flatMap((p) => p.flows);
    const value = parts.reduce((s, p) => s + p.value, 0);
    rep = {
      invested: parts.reduce((s, p) => s + p.invested, 0), withdrawn: parts.reduce((s, p) => s + p.withdrawn, 0), value,
      units: 0, skipped: parts.flatMap((p) => p.skipped), shortfall: parts.reduce((s, p) => s + p.shortfall, 0), flows: all,
      series: dates.map((d, i) => ({ date: d, value: parts.reduce((s, p) => s + (p.series[i]?.value ?? 0), 0) })),
      xirr: xirr(value > 0 ? [...all, { date: today, amount: value }] : all),
    };
  }

  let actualDrawdown: number | null = null;
  if (holdings.length === 1) {
    const s = await priceSeries(holdings[0].instrument.id);
    actualDrawdown = s.length ? maxDrawdown(s.filter((p) => p.date >= firstDate).map((p) => priceOf(holdings[0].instrument, p))) : null;
  }
  return {
    holdings, alt, altInstrument, firstDate,
    actual: { invested: sum(flows, -1), withdrawn: sum(flows, 1), value: t.value, xirr: t.xirr, series: actualSeries },
    replay: rep,
    drawdown: { actual: actualDrawdown, alternative: altDrawdown },
  };
}
