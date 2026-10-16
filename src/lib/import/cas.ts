// Maps casparser JSON (CAMS / KFintech MF statements, NSDL / CDSL demat statements)
// to ledger rows. MF statements carry full transaction history; demat statements
// carry holdings only, which become "opening balance" rows for any gap.
import { dedup, type ImportPreview, type ImportRow } from "./types";
import type { TxnType } from "@/lib/calc/fifo";

type Dec = string | number | null | undefined;
const n = (v: Dec) => (v == null || v === "" ? 0 : Number(v));

interface CasTxn { date: string; description: string; amount?: Dec; units?: Dec; nav?: Dec; type: string }
interface CasScheme { scheme: string; isin?: string | null; amfi?: string | null; rta?: string; transactions: CasTxn[]; close?: Dec; valuation?: { nav?: Dec; date?: string; cost?: Dec } }
interface CasFolio { folio: string; amc: string; schemes: CasScheme[] }
interface CasJson {
  file_type: string; cas_type?: string;
  statement_period?: { from?: string; from_?: string; to?: string };
  folios?: CasFolio[];
  accounts?: { name: string; type: string; dp_id?: string; client_id?: string;
    equities?: { name?: string; isin: string; num_shares: Dec; price: Dec; value: Dec; symbol?: string | null }[];
    mutual_funds?: { name?: string; isin: string; amfi?: string | null; balance: Dec; nav: Dec; value?: Dec; avg_cost?: Dec; total_cost?: Dec; folio?: string | null }[] }[];
  parse_warnings?: string[];
}

const TYPE_MAP: Record<string, TxnType | "fee" | "skip"> = {
  PURCHASE: "buy", PURCHASE_SIP: "sip", REDEMPTION: "sell",
  SWITCH_IN: "switch_in", SWITCH_IN_MERGER: "switch_in", SWITCH_OUT: "switch_out", SWITCH_OUT_MERGER: "switch_out",
  DIVIDEND_PAYOUT: "dividend_payout", DIVIDEND_REINVEST: "dividend_reinvest",
  GIFT_IN: "switch_in", GIFT_OUT: "switch_out", SEGREGATION: "bonus",
  STAMP_DUTY_TAX: "fee", STT_TAX: "fee", TDS_TAX: "fee",
  MISC: "skip", UNKNOWN: "skip",
};

function isoDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d) ?? null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(d);
  if (m2) {
    const mon = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m2[2].toLowerCase()) + 1;
    return `${m2[3]}-${String(mon).padStart(2, "0")}-${m2[1]}`;
  }
  return d;
}

export function mapCas(json: CasJson, filename: string): ImportPreview {
  const ft = (json.file_type ?? "").toUpperCase();
  if (ft === "NSDL" || ft === "CDSL" || json.accounts) return mapDemat(json, filename);

  const rows: ImportRow[] = [];
  const skipped: ImportPreview["skipped"] = [];
  const warnings = [...(json.parse_warnings ?? [])];
  if ((json.cas_type ?? "").toUpperCase() === "SUMMARY") {
    warnings.push("This is a summary statement: it has balances but no transactions. Request a DETAILED statement from CAMS/KFintech for full history and XIRR.");
  }
  const seen = new Map<string, number>();

  for (const folio of json.folios ?? []) {
    for (const sc of folio.schemes ?? []) {
      // Stamp duty / STT / TDS lines are folded into the fees of the same-day main transaction.
      const feeByDate = new Map<string, number>();
      for (const t of sc.transactions ?? []) {
        if (TYPE_MAP[t.type] === "fee") feeByDate.set(isoDate(t.date), (feeByDate.get(isoDate(t.date)) ?? 0) + Math.abs(n(t.amount)));
      }
      for (const t of sc.transactions ?? []) {
        const date = isoDate(t.date);
        let mapped = TYPE_MAP[t.type] ?? "skip";
        if (mapped === "fee") continue;
        if (t.type === "REVERSAL") mapped = n(t.units) < 0 ? "sell" : "buy"; // bounced SIP etc.
        if (mapped === "skip") { skipped.push({ reason: t.type, detail: `${sc.scheme} ${date}: ${t.description}` }); continue; }
        const units = Math.abs(n(t.units));
        const amount = Math.abs(n(t.amount));
        const price = n(t.nav) || (units ? amount / units : 0);
        if (mapped !== "dividend_payout" && units === 0) { skipped.push({ reason: "no units", detail: `${sc.scheme} ${date}: ${t.description}` }); continue; }
        const fees = feeByDate.get(date) ?? 0;
        if (fees) feeByDate.delete(date); // attach once
        rows.push({
          assetHint: "mf", isin: sc.isin ?? null, amfiCode: sc.amfi ?? null, symbol: null, name: sc.scheme,
          date, type: mapped as TxnType, units: mapped === "dividend_payout" ? 0 : units, price,
          amount: mapped === "bonus" ? 0 : amount,
          // fees on purchases are paid on top (stamp duty); on redemptions they come out (STT/TDS)
          fees,
          account: { kind: "folio", provider: sc.rta || ft || "CAS", ref: folio.folio },
          dedupKey: dedup(["cas", folio.folio, sc.isin ?? sc.amfi ?? sc.scheme, date, mapped, units, amount], seen),
        });
      }
    }
  }
  return { source: "cas", filename, rows, skipped, warnings, meta: { fileType: ft, period: json.statement_period } };
}

function mapDemat(json: CasJson, filename: string): ImportPreview {
  const asOf = isoDate(json.statement_period?.to ?? new Date().toISOString().slice(0, 10));
  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  for (const acc of json.accounts ?? []) {
    const ref = `${acc.dp_id ?? ""}${acc.client_id ?? ""}` || acc.name;
    const provider = (acc.type || json.file_type || "Demat").toUpperCase();
    for (const e of acc.equities ?? []) {
      const units = n(e.num_shares);
      if (units <= 0) continue;
      rows.push({
        assetHint: "unknown", isin: e.isin, amfiCode: null, symbol: e.symbol ?? null, name: e.name ?? e.isin,
        date: asOf, type: "buy", units, price: n(e.price), amount: units * n(e.price), fees: 0,
        account: { kind: "demat", provider, ref },
        dedupKey: dedup(["demat-open", ref, e.isin, asOf], seen),
        note: "Holding on statement date. Only the gap versus your ledger is imported; set the real average cost before saving.",
      });
    }
    for (const m of acc.mutual_funds ?? []) {
      const units = n(m.balance);
      if (units <= 0) continue;
      const avg = n(m.avg_cost) || (n(m.total_cost) && units ? n(m.total_cost) / units : 0);
      rows.push({
        assetHint: "mf", isin: m.isin, amfiCode: m.amfi ?? null, symbol: null, name: m.name ?? m.isin,
        date: asOf, type: "buy", units, price: avg || n(m.nav), amount: units * (avg || n(m.nav)), fees: 0,
        account: { kind: "demat", provider, ref },
        dedupKey: dedup(["demat-open", ref, m.isin, asOf], seen),
        note: avg ? "Cost from statement average cost." : "No cost on statement — using NAV; edit the average cost.",
      });
    }
  }
  return {
    source: "demat_cas", filename, rows, skipped: [],
    warnings: ["Demat statements list holdings, not trades. Import your broker tradebook for full history and XIRR; use this to fill gaps or check balances."],
    meta: { asOf, fileType: json.file_type },
  };
}
