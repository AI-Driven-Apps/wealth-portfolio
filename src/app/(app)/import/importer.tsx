"use client";
import { useActionState, useState, useTransition } from "react";
import clsx from "clsx";
import { previewImport, commitPreview } from "./actions";
import type { PreviewRow } from "@/lib/import/commit";
import type { ImportPreview } from "@/lib/import/types";

type P = ImportPreview & { rows: PreviewRow[] };

const KINDS = [
  { k: "cas", title: "Mutual fund statement (CAS)", hint: "Detailed CAS PDF from CAMS or KFintech, or an NSDL/CDSL demat CAS. Password is usually your PAN in capitals.", accept: ".pdf", password: true, broker: false },
  { k: "tradebook", title: "Broker tradebook", hint: "XLS, XLSX or CSV tradebook from Zerodha, Dhan, Groww, Upstox and most others. Columns are matched by name.", accept: ".xls,.xlsx,.csv", password: false, broker: true },
  { k: "contract_note", title: "Contract note", hint: "PDF contract note. Statutory charges are spread across the trades so they land in your cost. Use either tradebooks or contract notes for a period, not both.", accept: ".pdf", password: true, broker: true },
] as const;

const TYPE_LABEL: Record<string, string> = { buy: "Buy", sell: "Sell", sip: "SIP", switch_in: "Switch in", switch_out: "Switch out", dividend_payout: "Dividend", dividend_reinvest: "Div. reinvest", bonus: "Bonus", split: "Split" };
const fmt = (n: number, d = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: d });

export function Importer() {
  const [kind, setKind] = useState<(typeof KINDS)[number]["k"]>("cas");
  const [state, action, pending] = useActionState(previewImport, null);
  const [result, commit, committing] = useActionState(commitPreview, null);
  const [, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<number, number>>({});
  const k = KINDS.find((x) => x.k === kind)!;
  const preview: P | null = state && "preview" in state ? state.preview : null;

  const rows: PreviewRow[] = (preview?.rows as PreviewRow[] | undefined)?.map((r, i) => (edits[i] != null ? { ...r, price: edits[i], amount: r.units * edits[i] } : r)) ?? [];
  const save = () => startTransition(() => commit(JSON.stringify({ ...preview, rows })));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {KINDS.map((x) => (
          <button key={x.k} role="tab" aria-selected={kind === x.k} onClick={() => setKind(x.k)}
            className={clsx("rounded-lg px-3 py-1.5 text-[13px]", kind === x.k ? "bg-accent-soft font-semibold text-accent" : "border border-line bg-panel text-ink-2 hover:bg-panel-2")}>{x.title}</button>
        ))}
      </div>
      <form action={action} className="rounded-xl border border-line bg-panel p-4" key={kind}>
        <p className="mb-3 text-[13px] text-ink-2">{k.hint}</p>
        <input type="hidden" name="kind" value={kind} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1 sm:col-span-2"><label htmlFor="file">File</label><input id="file" name="file" type="file" accept={k.accept} required /></div>
          {k.password && <div className="flex flex-col gap-1"><label htmlFor="pw">PDF password</label><input id="pw" name="password" type="password" autoComplete="off" /></div>}
          {k.broker && <>
            <div className="flex flex-col gap-1"><label htmlFor="broker">Broker</label><input id="broker" name="broker" placeholder="e.g. Zerodha" list="brokers" required />
              <datalist id="brokers"><option value="Zerodha" /><option value="Dhan" /><option value="Groww" /><option value="Upstox" /><option value="ICICI Direct" /><option value="HDFC Securities" /><option value="Angel One" /><option value="Kotak Securities" /></datalist></div>
            <div className="flex flex-col gap-1"><label htmlFor="acct">Client / demat id</label><input id="acct" name="accountRef" placeholder="e.g. AB1234" required /></div>
          </>}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Reading…" : "Preview"}</button>
          <span className="text-[12px] text-ink-3">Nothing is saved until you confirm. The file itself is never stored.</span>
        </div>
        {state && "error" in state && <p className="mt-3 text-[13px] text-loss">{state.error}</p>}
      </form>

      {preview && (
        <div className="rounded-xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="text-[13px]"><b>{preview.filename}</b> · {rows.length} transaction{rows.length === 1 ? "" : "s"} to save{preview.skipped.length ? ` · ${preview.skipped.length} skipped` : ""}</div>
            <button onClick={save} disabled={committing || !rows.length || !!(result && "ok" in result)} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{committing ? "Saving…" : `Save ${rows.length} transactions`}</button>
          </div>
          {(preview.warnings.length > 0 || result) && (
            <div className="space-y-1 border-b border-line px-4 py-3 text-[13px]">
              {preview.warnings.map((w) => <p key={w} className="text-warn">{w}</p>)}
              {result && "ok" in result && <p className="font-medium text-gain">{result.ok}</p>}
              {result && "error" in result && <p className="text-loss">{result.error}</p>}
            </div>
          )}
          <div className="max-h-[520px] overflow-auto">
            <table>
              <thead className="sticky top-0 bg-panel"><tr><th>Date</th><th>Holding</th><th>Type</th><th className="r">Units</th><th className="r">Price</th><th className="r">Amount</th><th className="r">Charges</th><th>Account</th></tr></thead>
              <tbody>
                {rows.slice(0, 1000).map((r, i) => (
                  <tr key={r.dedupKey}>
                    <td className="whitespace-nowrap">{r.date}</td>
                    <td className="max-w-[320px]">
                      <div className="truncate">{r.instrumentName ?? r.name}</div>
                      <div className="text-[11px] text-ink-3">{r.isNew ? <span className="text-warn">new instrument · </span> : null}{r.symbol ?? r.amfiCode ?? r.isin}{r.note ? ` · ${r.note}` : ""}</div>
                    </td>
                    <td>{TYPE_LABEL[r.type]}</td>
                    <td className="r num">{fmt(r.units, 4)}</td>
                    <td className="r num">{preview.source === "demat_cas"
                      ? <input type="number" step="any" min="0" aria-label="Average cost" className="w-24 text-right" defaultValue={r.price} onChange={(e) => setEdits((x) => ({ ...x, [i]: Number(e.target.value) }))} />
                      : fmt(r.price, 4)}</td>
                    <td className="r num">{fmt(r.amount)}</td>
                    <td className="r num">{r.fees ? fmt(r.fees) : "—"}</td>
                    <td className="text-ink-2">{r.account.provider} {r.account.ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 1000 && <p className="px-4 py-2 text-[12px] text-ink-3">Showing the first 1,000 of {rows.length} rows; all will be saved.</p>}
          </div>
          {preview.skipped.length > 0 && (
            <details className="border-t border-line px-4 py-3 text-[13px]">
              <summary className="cursor-pointer text-ink-2">Skipped lines ({preview.skipped.length})</summary>
              <ul className="mt-2 space-y-0.5 text-[12px] text-ink-3">{preview.skipped.slice(0, 200).map((s, i) => <li key={i}><b>{s.reason}</b>: {s.detail}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
