import type { TxnType } from "@/lib/calc/fifo";

/** One normalised ledger row, as shown in the import preview and later committed. */
export interface ImportRow {
  assetHint: "mf" | "stock" | "etf" | "unknown";
  isin: string | null;
  amfiCode: string | null;
  symbol: string | null;
  name: string;
  date: string;
  type: TxnType;
  units: number;
  price: number;
  amount: number;
  fees: number;
  account: { kind: "folio" | "demat"; provider: string; ref: string };
  dedupKey: string;
  note?: string;
}

export interface ImportPreview {
  source: "cas" | "demat_cas" | "tradebook" | "contract_note";
  filename: string;
  rows: ImportRow[];
  skipped: { reason: string; detail: string }[];
  warnings: string[];
  meta?: Record<string, unknown>;
}

/** Stable key for a row; `n` disambiguates identical rows within one file. */
export function dedup(parts: (string | number | null | undefined)[], seen: Map<string, number>): string {
  const base = parts.map((p) => (p == null ? "" : typeof p === "number" ? p.toFixed(4) : p)).join("|");
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}#${n}`;
}
