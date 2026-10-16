// Market data for stocks, ETFs and index benchmarks.
// Mirrors NSE-Signal's DataProvider rule: Yahoo is unofficial and breaks, so
// nothing outside this file talks to it.
import YahooFinance from "yahoo-finance2";

export interface Bar { date: string; close: number; adjClose: number | null }

type YF = { chart: (s: string, o: object) => Promise<{ quotes: { date: Date; close: number | null; adjclose?: number | null }[] }>; quoteSummary: (s: string, o: object) => Promise<{ assetProfile?: { sector?: string; industry?: string } }>; suppressNotices?: (n: string[]) => void };
let yf: YF | null = null;
function client(): YF {
  if (!yf) {
    const Ctor = YahooFinance as unknown as { new?: () => YF } & YF;
    // yahoo-finance2 v2 exports a ready instance; v3 exports a class.
    yf = typeof Ctor === "function" ? new (Ctor as unknown as new () => YF)() : (Ctor as YF);
    yf.suppressNotices?.(["yahooSurvey", "ripHistorical"]);
  }
  return yf;
}

/** "RELIANCE" -> "RELIANCE.NS"; index tickers (^NSEI) and suffixed symbols pass through. */
export function toYahoo(nseSymbol: string): string {
  if (nseSymbol.startsWith("^") || nseSymbol.includes(".")) return nseSymbol;
  return `${nseSymbol.toUpperCase()}.NS`;
}

/** Daily bars from `start` (yyyy-mm-dd) to today. Raw close for valuation, adjclose for returns. */
export async function fetchDaily(symbol: string, start: string): Promise<Bar[]> {
  const res = await client().chart(symbol, { period1: start, interval: "1d" });
  const out: Bar[] = [];
  for (const q of res.quotes ?? []) {
    if (q.close == null || !(q.close > 0)) continue;
    // Yahoo stamps NSE bars at 09:15 IST (03:45 UTC) — the UTC date is the trading date.
    out.push({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close, adjClose: q.adjclose ?? null });
  }
  return out;
}

export async function fetchSector(symbol: string): Promise<string | null> {
  try {
    const r = await client().quoteSummary(symbol, { modules: ["assetProfile"] });
    return r.assetProfile?.sector ?? null;
  } catch {
    return null;
  }
}
