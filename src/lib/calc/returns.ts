import { addYears, toDayNum, yearsBetween } from "./dates";

/** CAGR between two values over `years`. Null for non-positive inputs or < 1 year. */
export function cagr(start: number, end: number, years: number): number | null {
  if (!(start > 0) || !(end > 0) || !(years > 0)) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

export interface PricePoint { date: string; close: number }

/** Last point on or before `iso` (series ascending). Binary search. */
export function pointOnOrBefore(series: PricePoint[], iso: string): PricePoint | null {
  let lo = 0, hi = series.length - 1, ans: PricePoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= iso) { ans = series[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Trailing return for a NAV/price series. Under 1 year: absolute return;
 * 1 year or more: CAGR (the convention Indian fund factsheets use).
 * Null if the series does not reach back far enough (allows 7 days of slack for holidays).
 */
export function trailingReturn(series: PricePoint[], years: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const from = addYears(last.date, -years);
  const start = pointOnOrBefore(series, from);
  if (!start) {
    const first = series[0];
    if (toDayNum(first.date) - toDayNum(from) > 7) return null;
    return calc(first, last, years);
  }
  return calc(start, last, years);
}

function calc(a: PricePoint, b: PricePoint, years: number): number | null {
  if (years < 1) return a.close > 0 ? b.close / a.close - 1 : null;
  return cagr(a.close, b.close, yearsBetween(a.date, b.date));
}

/** 52-week high/low and where the latest price sits in that range (0..1). */
export function range52w(series: PricePoint[]) {
  if (!series.length) return null;
  const last = series[series.length - 1];
  const from = addYears(last.date, -1);
  const win = series.filter((p) => p.date >= from);
  const hi = Math.max(...win.map((p) => p.close));
  const lo = Math.min(...win.map((p) => p.close));
  return { high: hi, low: lo, last: last.close, position: hi > lo ? (last.close - lo) / (hi - lo) : 1 };
}

/** Max drawdown of a value series (<= 0). Ported from NSE-Signal's backtester. */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity, dd = 0;
  for (const v of values) { peak = Math.max(peak, v); if (peak > 0) dd = Math.min(dd, v / peak - 1); }
  return dd;
}

/** Annualised Sharpe of daily returns (risk-free 0), 252 trading days — as NSE-Signal. */
export function sharpe(values: number[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) if (values[i - 1] > 0) rets.push(values[i] / values[i - 1] - 1);
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : null;
}
