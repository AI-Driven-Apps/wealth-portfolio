import type { CashFlow } from "./xirr";

export type TxnType =
  | "buy" | "sell" | "sip" | "switch_in" | "switch_out"
  | "dividend_payout" | "dividend_reinvest" | "bonus" | "split";

export interface LedgerTxn {
  date: string;
  type: TxnType;
  units: number;   // split: ratio new/old (e.g. 5 for a 1→5 split)
  price: number;
  amount: number;  // positive rupees
  fees: number;
}

export interface Lot { date: string; units: number; costPerUnit: number }

export interface RealizedGain {
  sellDate: string; buyDate: string; units: number;
  cost: number; proceeds: number; gain: number; holdingDays: number;
}

export interface Position {
  units: number;
  invested: number;        // cost of units still held (FIFO)
  avgCost: number;
  realized: number;        // realised P/L on units sold
  dividends: number;       // payout dividends received as cash
  lots: Lot[];
  realizedGains: RealizedGain[];
  flows: CashFlow[];       // external cash flows for XIRR (no terminal value)
  firstDate: string | null;
  warnings: string[];
}

const IN = new Set<TxnType>(["buy", "sip", "switch_in", "dividend_reinvest"]);
const OUT = new Set<TxnType>(["sell", "switch_out"]);
// Same-day ordering: corporate actions, then inflows, then outflows.
const ORDER: Record<TxnType, number> = {
  split: 0, bonus: 1, buy: 2, sip: 2, switch_in: 2, dividend_reinvest: 2,
  dividend_payout: 3, sell: 4, switch_out: 4,
};
const EPS = 1e-4;

/**
 * FIFO cost basis for one instrument in one profile — the method Indian
 * capital-gains rules use for both equity and mutual fund units.
 */
export function buildPosition(txns: LedgerTxn[]): Position {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type]);
  const lots: Lot[] = [];
  const realizedGains: RealizedGain[] = [];
  const flows: CashFlow[] = [];
  const warnings: string[] = [];
  let realized = 0, dividends = 0;

  for (const t of sorted) {
    if (IN.has(t.type)) {
      if (t.units <= 0) continue;
      const cost = t.amount + t.fees;
      lots.push({ date: t.date, units: t.units, costPerUnit: cost / t.units });
      // A reinvested dividend never left your pocket: no external flow.
      if (t.type !== "dividend_reinvest") flows.push({ date: t.date, amount: -cost });
    } else if (OUT.has(t.type)) {
      let remaining = t.units;
      const proceeds = t.amount - t.fees;
      const pricePerUnit = t.units > 0 ? proceeds / t.units : 0;
      while (remaining > EPS && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.units, remaining);
        const cost = take * lot.costPerUnit;
        const p = take * pricePerUnit;
        realizedGains.push({
          sellDate: t.date, buyDate: lot.date, units: take, cost, proceeds: p, gain: p - cost,
          holdingDays: Math.round((Date.parse(t.date) - Date.parse(lot.date)) / 86_400_000),
        });
        realized += p - cost;
        lot.units -= take;
        remaining -= take;
        if (lot.units <= EPS) lots.shift();
      }
      if (remaining > EPS) warnings.push(`${t.date}: sold ${remaining.toFixed(4)} more units than held — check for missing purchases`);
      flows.push({ date: t.date, amount: proceeds });
    } else if (t.type === "bonus") {
      if (t.units > 0) lots.push({ date: t.date, units: t.units, costPerUnit: 0 });
    } else if (t.type === "split") {
      const r = t.units;
      if (r > 0) for (const lot of lots) { lot.units *= r; lot.costPerUnit /= r; }
    } else if (t.type === "dividend_payout") {
      dividends += t.amount;
      flows.push({ date: t.date, amount: t.amount });
    }
  }

  const units = lots.reduce((s, l) => s + l.units, 0);
  const invested = lots.reduce((s, l) => s + l.units * l.costPerUnit, 0);
  return {
    units: units < EPS ? 0 : units,
    invested: units < EPS ? 0 : invested,
    avgCost: units > EPS ? invested / units : 0,
    realized, dividends, lots, realizedGains, flows,
    firstDate: sorted[0]?.date ?? null,
    warnings,
  };
}
