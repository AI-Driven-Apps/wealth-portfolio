// Categories on the 52-week page. A stock can sit in several (NIFTY 50, F&O and
// SENSEX overlap heavily); "Other" is a stock in none of them. The NIFTY 50 and F&O
// lists come from NSE via the index-members job. Neither exchange publishes SENSEX
// as a static file, so it is kept here: review it after each half-yearly rejig
// (effective late June and late December).
export const SENSEX_AS_OF = "2026-10";
export const SENSEX = [
  "ADANIPORTS", "ASIANPAINT", "AXISBANK", "BAJAJFINSV", "BAJFINANCE", "BEL", "BHARTIARTL", "ETERNAL",
  "HCLTECH", "HDFCBANK", "HINDUNILVR", "ICICIBANK", "INDIGO", "INFY", "ITC", "KOTAKBANK", "LT", "M&M",
  "MARUTI", "NTPC", "POWERGRID", "RELIANCE", "SBIN", "SUNPHARMA", "TATASTEEL", "TCS", "TECHM", "TITAN",
  "TMPV", "TRENT", "ULTRACEMCO",
];

export const INDEX_MEMBERS_KEY = "index_members";
export interface IndexMembers { nifty50: string[]; fno: string[]; asOf: string | null }

export const CATEGORIES = [
  { key: "nifty", label: "NIFTY 50" },
  { key: "fno", label: "F&O" },
  { key: "sensex", label: "SENSEX" },
  { key: "mf", label: "MF" },
  { key: "etf", label: "ETF" },
  { key: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["key"];

export interface MemberSets { nifty: Set<string>; fno: Set<string>; sensex: Set<string> }

export function memberSets(m: IndexMembers): MemberSets {
  return { nifty: new Set(m.nifty50), fno: new Set(m.fno), sensex: new Set(SENSEX) };
}

export function categoriesOf(ins: { type: string; nseSymbol: string | null }, s: MemberSets): Category[] {
  if (ins.type === "mf") return ["mf"];
  if (ins.type === "etf") return ["etf"];
  const sym = ins.nseSymbol?.toUpperCase() ?? "";
  const out: Category[] = [];
  if (s.nifty.has(sym)) out.push("nifty");
  if (s.fno.has(sym)) out.push("fno");
  if (s.sensex.has(sym)) out.push("sensex");
  return out.length ? out : ["other"];
}
