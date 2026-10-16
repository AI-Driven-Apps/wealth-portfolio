import { dedup, type ImportPreview, type ImportRow } from "./types";

interface ParsedNote {
  trade_date: string | null;
  trades: { side: "buy" | "sell"; quantity: number; price: number; net_rate: number | null; security: string; isin: string | null; trade_no: string | null; date: string | null }[];
  charges: Record<string, number>;
  total_charges: number;
}

/**
 * Contract-note trades with statutory charges spread across trades in
 * proportion to trade value, so they land in each lot's cost / proceeds.
 */
export function mapContractNote(p: ParsedNote, filename: string, broker: string, accountRef: string): ImportPreview {
  const seen = new Map<string, number>();
  const gross = p.trades.reduce((s, t) => s + t.quantity * t.price, 0);
  const warnings: string[] = [];
  if (!p.trades.length) warnings.push("No trade table found. This parser reads tables with buy/sell, quantity and price columns; if your broker's layout differs, import the tradebook instead.");
  if (!p.trade_date && p.trades.some((t) => !t.date)) warnings.push("Trade date not found on the note — check the dates below before saving.");
  const rows: ImportRow[] = p.trades.map((t) => {
    const value = t.quantity * t.price;
    // brokerage is already inside net_rate when the note shows it; statutory charges are not
    const brokerage = t.net_rate ? Math.abs(t.net_rate - t.price) * t.quantity : 0;
    const share = gross ? (value / gross) * (p.total_charges - (p.charges.brokerage ?? 0)) : 0;
    // "INFY - INFOSYS LIMITED" -> symbol INFY, name INFOSYS LIMITED
    const m = /^([A-Z0-9&_-]+)\s+-\s+(.+)$/.exec(t.security.trim());
    const symbol = (m ? m[1] : t.security.split(/\s+/)[0])?.toUpperCase() || null;
    return {
      assetHint: "unknown", isin: t.isin, amfiCode: null, symbol, name: m ? m[2] : t.security,
      date: t.date ?? p.trade_date ?? "", type: t.side, units: t.quantity, price: t.price, amount: value,
      fees: Math.round((brokerage + Math.max(0, share)) * 100) / 100,
      account: { kind: "demat", provider: broker, ref: accountRef },
      dedupKey: dedup(t.trade_no ? ["trade", broker.toLowerCase(), t.trade_no] : ["trade", broker.toLowerCase(), t.isin ?? symbol, t.date ?? p.trade_date, t.side, t.quantity, t.price], seen),
    };
  });
  return { source: "contract_note", filename, rows, skipped: [], warnings, meta: { charges: p.charges, totalCharges: p.total_charges } };
}
