import { xirr, type CashFlow } from "./xirr";
import { growth } from "./fixed";
import { yearsBetween } from "./dates";
import { pointOnOrBefore, type PricePoint } from "./returns";

// What-if: replay your real dated cash flows into an alternative and compare.
// Investments buy the alternative at its price that day; withdrawals (sales,
// payout dividends) take the same rupees out of it. An alternative is just a
// price function, so another fund, an index, gold or an FD all replay the same way.

export type PriceAt = (date: string) => PricePoint | null;

export interface ReplayResult {
  invested: number;
  withdrawn: number;
  value: number;
  units: number;
  xirr: number | null;
  /** Investments made before the alternative's history starts; left out of the replay. */
  skipped: CashFlow[];
  /** Rupees you withdrew that the alternative could not have paid (it was worth less). */
  shortfall: number;
  series: { date: string; value: number }[];
  /** The flows that actually happened in the alternative (no terminal value), for combining replays. */
  flows: CashFlow[];
}

export function seriesPriceAt(series: PricePoint[]): PriceAt {
  return (d) => pointOnOrBefore(series, d);
}

/** A fixed deposit as a price series: ₹1 on `base`, compounding quarterly at `ratePct`. */
export function fdPriceAt(ratePct: number, base: string): PriceAt {
  return (d) => (d < base ? null : { date: d, close: growth(ratePct, "quarterly", yearsBetween(base, d)) });
}

export function replay(flows: CashFlow[], priceAt: PriceAt, valueDate: string, sampleDates: string[] = []): ReplayResult {
  const sorted = [...flows].filter((f) => f.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  const samples = [...sampleDates].sort();
  let units = 0, invested = 0, withdrawn = 0, shortfall = 0, si = 0;
  const skipped: CashFlow[] = [], realised: CashFlow[] = [], series: ReplayResult["series"] = [];
  const sampleUpTo = (d: string, inclusive: boolean) => {
    while (si < samples.length && (inclusive ? samples[si] <= d : samples[si] < d)) {
      const p = priceAt(samples[si]);
      series.push({ date: samples[si], value: p ? units * p.close : 0 });
      si++;
    }
  };
  for (const f of sorted) {
    sampleUpTo(f.date, false);
    const p = priceAt(f.date);
    if (f.amount < 0) {
      if (!p || !(p.close > 0)) { skipped.push(f); continue; }
      units += -f.amount / p.close;
      invested += -f.amount;
      realised.push(f);
    } else {
      if (!p || !(p.close > 0)) { shortfall += f.amount; continue; }
      const want = f.amount / p.close;
      const take = Math.min(units, want);
      units -= take;
      withdrawn += take * p.close;
      shortfall += (want - take) * p.close;
      if (take > 0) realised.push({ date: f.date, amount: take * p.close });
    }
  }
  sampleUpTo(valueDate, true);
  const last = priceAt(valueDate);
  const value = last ? units * last.close : 0;
  return {
    invested, withdrawn, value, units, skipped, shortfall, series, flows: realised,
    xirr: xirr(value > 0 ? [...realised, { date: valueDate, amount: value }] : realised),
  };
}

/** The same money, all invested on the first day (withdrawals unchanged). */
export function asLumpSum(flows: CashFlow[]): CashFlow[] {
  const ins = flows.filter((f) => f.amount < 0);
  if (!ins.length) return flows;
  const first = ins.reduce((d, f) => (f.date < d ? f.date : d), ins[0].date);
  return [{ date: first, amount: ins.reduce((s, f) => s + f.amount, 0) }, ...flows.filter((f) => f.amount > 0)];
}

/** "What if I had stopped investing after `date`": later investments dropped, withdrawals kept. */
export function stoppedAfter(flows: CashFlow[], date: string): CashFlow[] {
  return flows.filter((f) => f.amount > 0 || f.date <= date);
}
