"use client";
import { useActionState, useMemo, useState, useTransition, type FormEvent } from "react";
import clsx from "clsx";
import { previewImport, commitPreview, commitRecords, type TxnPreview, type RecordsResult } from "./actions";
import type { PreviewRow } from "@/lib/import/commit";
import { TXN_FIELDS } from "@/lib/import/fields";
import { InstrumentPicker } from "@/components/instrument-picker";
import { SipSuggestions } from "@/components/sip-suggestions";

type Kind = "cas" | "tradebook" | "contract_note" | "spreadsheet" | "fixed" | "loans";

const KINDS: { k: Kind; title: string; hint: string; accept: string; password?: boolean; broker?: boolean; template?: string; feature?: string }[] = [
  { k: "cas", title: "Mutual fund statement (CAS)", hint: "Detailed CAS PDF from CAMS or KFintech, or an NSDL/CDSL demat CAS. Password is usually your PAN in capitals.", accept: ".pdf", password: true },
  { k: "tradebook", title: "Broker tradebook", hint: "XLS, XLSX or CSV tradebook from Zerodha, Dhan, Groww, Upstox and most others. Columns are matched by name.", accept: ".xls,.xlsx,.csv", broker: true },
  { k: "contract_note", title: "Contract note", hint: "PDF contract note. Statutory charges are spread across the trades so they land in your cost. Use either tradebooks or contract notes for a period, not both.", accept: ".pdf", password: true, broker: true },
  { k: "spreadsheet", title: "Any spreadsheet", hint: "Transactions from any platform's export (Groww, Kuvera, Coin…) or your own records. Columns are matched by name and can be re-mapped below. Needs a date, a name/symbol/ISIN, and two of units, price and amount.", accept: ".xls,.xlsx,.csv", template: "transactions" },
  { k: "fixed", title: "Deposits & savings", hint: "FDs, RDs, bonds, PPF/EPF/NPS balances, gold, cash and property, one per row. Holdings whose name already exists are left unchanged.", accept: ".xls,.xlsx,.csv", template: "fixed", feature: "other" },
  { k: "loans", title: "Loans", hint: "One row per loan; extra rows with an event (prepayment or rate change) for the same loan name. Events can also be added to a loan you've already saved.", accept: ".xls,.xlsx,.csv", template: "loans", feature: "loans" },
];

const TYPE_LABEL: Record<string, string> = { buy: "Buy", sell: "Sell", sip: "SIP", switch_in: "Switch in", switch_out: "Switch out", dividend_payout: "Dividend", dividend_reinvest: "Div. reinvest", bonus: "Bonus", split: "Split" };
const fmt = (n: number, d = 2) => n.toLocaleString("en-IN", { maximumFractionDigits: d });
const identity = (r: PreviewRow) => r.amfiCode ?? r.isin ?? r.symbol ?? r.name.toLowerCase();
const btnPrimary = "rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50";

export function Importer({ basePath, features, pdf }: { basePath: string; features: string[]; pdf: boolean }) {
  // PDF kinds need the parser service; without it the spreadsheet kinds still work.
  const kinds = KINDS.filter((x) => (!x.feature || features.includes(x.feature)) && (pdf || x.accept !== ".pdf"));
  const [kind, setKind] = useState<Kind>(kinds[0].k);
  const [state, action, pending] = useActionState(previewImport, null);
  const [, start] = useTransition();
  const k = kinds.find((x) => x.k === kind)!;
  const preview = state && "preview" in state ? state.preview : null;
  const records = state && "records" in state ? state.records : null;

  // Submitting by hand (not <form action>) keeps the chosen file in the input,
  // so "Preview" can be pressed again after changing the column mapping.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => action(fd));
  };

  return (
    <div className="space-y-4">
      {!pdf && <p className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent">PDF statements (CAS, contract notes) need the parser service, which isn&apos;t configured here. Tradebooks, spreadsheets, deposits and loans import as usual.</p>}
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {kinds.map((x) => (
          <button key={x.k} role="tab" aria-selected={kind === x.k} onClick={() => setKind(x.k)}
            className={clsx("rounded-lg px-3 py-1.5 text-[13px]", kind === x.k ? "bg-accent-soft font-semibold text-accent" : "border border-line bg-panel text-ink-2 hover:bg-panel-2")}>{x.title}</button>
        ))}
      </div>
      <form onSubmit={submit} className="rounded-xl border border-line bg-panel p-4" key={kind}>
        <p className="mb-3 text-[13px] text-ink-2">{k.hint}{k.template && <> <a className="font-medium text-accent underline" href={`${basePath}/api/import/template/${k.template}`}>Download the template</a>.</>}</p>
        <input type="hidden" name="kind" value={kind} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1 sm:col-span-2"><label htmlFor="file">File</label><input id="file" name="file" type="file" accept={k.accept} required /></div>
          {k.password && <div className="flex flex-col gap-1"><label htmlFor="pw">PDF password</label><input id="pw" name="password" type="password" autoComplete="off" /></div>}
          {k.broker && <>
            <div className="flex flex-col gap-1"><label htmlFor="broker">Broker</label><input id="broker" name="broker" placeholder="e.g. Zerodha" list="brokers" required />
              <datalist id="brokers"><option value="Zerodha" /><option value="Dhan" /><option value="Groww" /><option value="Upstox" /><option value="ICICI Direct" /><option value="HDFC Securities" /><option value="Angel One" /><option value="Kotak Securities" /></datalist></div>
            <div className="flex flex-col gap-1"><label htmlFor="acct">Client / demat id</label><input id="acct" name="accountRef" placeholder="e.g. AB1234" required /></div>
          </>}
          {kind === "tradebook" && (
            <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
              <label htmlFor="codes">Broker code list (optional)</label>
              <input id="codes" name="codes" type="file" accept={pdf ? ".xls,.xlsx,.csv,.pdf" : ".xls,.xlsx,.csv"} />
              <span className="text-[12px] text-ink-3">Only if the tradebook names stocks by the broker&apos;s own code (HDFC Securities &ldquo;3MINDLEQNR&rdquo;) instead of a symbol or ISIN: the broker&apos;s list with a code column (InternalCode, Scrip_ID…) and an ISIN or NSE symbol column, such as HDFC&apos;s monthly approved-securities list{pdf ? ", as CSV, Excel or a PDF table" : ", as CSV or Excel"}. It&apos;s saved for this broker, so you add it once.</span>
            </div>
          )}
          {kind === "spreadsheet" && <div className="flex flex-col gap-1"><label htmlFor="platform">Platform (if not a column)</label><input id="platform" name="platform" placeholder="e.g. Kuvera" /></div>}
        </div>
        {kind === "spreadsheet" && preview?.columns && (
          <fieldset className="mt-4 rounded-lg border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold text-ink-2">Columns in &ldquo;{preview.columns.sheet}&rdquo; · change any and press Preview again</legend>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {TXN_FIELDS.map((f) => (
                <label key={f.field} className="flex flex-col gap-1">{f.label}
                  <select name={`map.${f.field}`} defaultValue={String(preview.columns!.map[f.field] ?? -1)}>
                    <option value="-1">— not in file —</option>
                    {preview.columns!.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button disabled={pending} className={btnPrimary}>{pending ? "Reading…" : "Preview"}</button>
          <span className="text-[12px] text-ink-3">Nothing is saved until you confirm. The file itself is never stored.</span>
        </div>
        {state && "error" in state && <p className="mt-3 text-[13px] text-loss">{state.error}</p>}
      </form>

      {preview && <TxnPreviewPanel key={`${preview.filename}-${preview.rows.length}-${JSON.stringify(preview.columns?.map ?? {})}`} preview={preview} basePath={basePath} />}
      {records && <RecordsPanel key={`${records.filename}-${records.preview.rows.length}`} records={records} />}
    </div>
  );
}

function TxnPreviewPanel({ preview, basePath }: { preview: TxnPreview; basePath: string }) {
  const [result, commit, committing] = useActionState(commitPreview, null);
  const [, start] = useTransition();
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [matches, setMatches] = useState<Record<string, { id: number; name: string }>>({});

  const rows = useMemo(() => (preview.rows as PreviewRow[]).map((r, i) => {
    let x = edits[i] != null ? { ...r, price: edits[i], amount: r.units * edits[i] } : r;
    const m = r.isNew ? matches[identity(r)] : undefined;
    if (m) x = { ...x, instrumentId: m.id, instrumentName: m.name, isNew: false };
    return x;
  }), [preview.rows, edits, matches]);
  const unknown = useMemo(() => {
    const g = new Map<string, { name: string; ref: string; n: number }>();
    for (const r of preview.rows as PreviewRow[]) if (r.isNew) {
      const id = identity(r);
      g.set(id, { name: r.name, ref: r.symbol ?? r.amfiCode ?? r.isin ?? "", n: (g.get(id)?.n ?? 0) + 1 });
    }
    return [...g.entries()];
  }, [preview.rows]);
  const chosen = rows.filter((_, i) => !excluded.has(i));
  const saved = !!(result && "ok" in result);
  const toggle = (i: number) => setExcluded((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const save = () => start(() => commit(JSON.stringify({ source: preview.source, filename: preview.filename, rows: chosen.map(({ instrumentName: _n, isNew: _i, ...r }) => r) })));

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="text-[13px]"><b>{preview.filename}</b> · {chosen.length} of {rows.length} transaction{rows.length === 1 ? "" : "s"} ticked{preview.skipped.length ? ` · ${preview.skipped.length} skipped` : ""}</div>
        <button onClick={save} disabled={committing || !chosen.length || saved} className={btnPrimary}>{committing ? "Saving…" : `Save ${chosen.length} transaction${chosen.length === 1 ? "" : "s"}`}</button>
      </div>
      {(preview.warnings.length > 0 || result) && (
        <div className="space-y-1 border-b border-line px-4 py-3 text-[13px]">
          {preview.warnings.map((w) => <p key={w} className="text-warn">{w}</p>)}
          {result && "ok" in result && <p className="font-medium text-gain">{result.ok}</p>}
          {result && "ok" in result && result.noSymbol.length > 0 && <p className="text-warn">No NSE symbol (so no prices yet) for: {result.noSymbol.slice(0, 6).join(", ")}{result.noSymbol.length > 6 ? "…" : ""}. The weekly NSE equity list job fills these in, or set them under Admin → Data sources.</p>}
          {result && "error" in result && <p className="text-loss">{result.error}</p>}
        </div>
      )}
      {result && "ok" in result && result.sips.length > 0 && (
        <div className="border-b border-line px-4 py-3"><h3 className="mb-2 text-[13px] font-semibold">SIPs found in your transactions</h3><SipSuggestions candidates={result.sips} /></div>
      )}
      {unknown.length > 0 && !saved && (
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Not recognised ({unknown.length})</h3>
          <p className="mb-2 text-[12px] text-ink-3">These will be added as new instruments. If one is a fund or stock you already have under another name, match it so the history lands in one place. A broker code you match is remembered for that broker.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {unknown.map(([id, u]) => (
              <div key={id} className="rounded-lg border border-line p-2.5">
                <div className="mb-1.5 truncate text-[13px] font-medium" title={u.name}>{u.name} <span className="font-normal text-ink-3">· {u.ref} · {u.n} row{u.n === 1 ? "" : "s"}</span></div>
                <InstrumentPicker basePath={basePath} name={`match-${id}`} label={matches[id] ? `Matched to` : "Match to an existing instrument (optional)"} placeholder="Search name, symbol, ISIN or AMFI code"
                  onPick={(h) => setMatches((m) => { const n = { ...m }; if (h) n[id] = { id: h.id, name: h.name }; else delete n[id]; return n; })} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="max-h-[520px] overflow-auto">
        <table>
          <thead className="sticky top-0 bg-panel"><tr>
            <th className="w-8"><input type="checkbox" aria-label="Select all rows" className="h-4 w-4" checked={!excluded.size} disabled={saved}
              onChange={(e) => setExcluded(e.target.checked ? new Set() : new Set(rows.map((_, i) => i)))} /></th>
            <th>Date</th><th>Holding</th><th>Type</th><th className="r">Units</th><th className="r">Price</th><th className="r">Amount</th><th className="r">Charges</th><th>Account</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 1000).map((r, i) => {
              // instrumentId set by the server = resolved through a saved broker code
              const byYou = !!r.instrumentId && !(preview.rows[i] as PreviewRow).instrumentId;
              return (
              <tr key={r.dedupKey} className={excluded.has(i) ? "opacity-45" : undefined}>
                <td><input type="checkbox" aria-label={`Include ${r.name} ${r.date}`} className="h-4 w-4" checked={!excluded.has(i)} onChange={() => toggle(i)} disabled={saved} /></td>
                <td className="whitespace-nowrap">{r.date}</td>
                <td className="max-w-[320px]">
                  <div className="truncate">{r.instrumentName ?? r.name}</div>
                  <div className="text-[11px] text-ink-3">{r.isNew ? <span className="text-warn">new instrument · </span> : byYou ? <span className="text-accent">matched by you · </span> : null}{r.symbol ?? r.amfiCode ?? r.isin}{r.note ? ` · ${r.note}` : ""}</div>
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
            ); })}
          </tbody>
        </table>
        {rows.length > 1000 && <p className="px-4 py-2 text-[12px] text-ink-3">Showing the first 1,000 of {rows.length} rows; all ticked rows will be saved.</p>}
      </div>
      <Skipped skipped={preview.skipped} />
    </div>
  );
}

function Skipped({ skipped }: { skipped: { reason: string; detail: string }[] }) {
  if (!skipped.length) return null;
  return (
    <details className="border-t border-line px-4 py-3 text-[13px]">
      <summary className="cursor-pointer text-ink-2">Skipped lines ({skipped.length})</summary>
      <ul className="mt-2 space-y-0.5 text-[12px] text-ink-3">{skipped.slice(0, 200).map((s, i) => <li key={i}><b>{s.reason}</b>: {s.detail}</li>)}</ul>
    </details>
  );
}

const KIND_LABEL: Record<string, string> = { fd: "FD", rd: "RD", bond: "Bond", ppf: "PPF", epf: "EPF", nps: "NPS", sgb: "SGB", gold: "Gold", reit: "REIT", cash: "Cash", other: "Other" };

function RecordsPanel({ records }: { records: RecordsResult }) {
  const [result, commit, committing] = useActionState(commitRecords, null);
  const [, start] = useTransition();
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const p = records.preview;
  const chosen = (p.rows as unknown[]).filter((_, i) => !excluded.has(i));
  const saved = !!(result && "ok" in result);
  const toggle = (i: number) => setExcluded((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const save = () => start(() => commit(JSON.stringify({ kind: records.kind, filename: records.filename, rows: chosen })));
  const check = (i: number) => <td><input type="checkbox" className="h-4 w-4" aria-label="Include row" checked={!excluded.has(i)} onChange={() => toggle(i)} disabled={saved} /></td>;

  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="text-[13px]"><b>{records.filename}</b> · {chosen.length} of {p.rows.length} ticked{p.skipped.length ? ` · ${p.skipped.length} skipped` : ""}</div>
        <button onClick={save} disabled={committing || !chosen.length || saved} className={btnPrimary}>{committing ? "Saving…" : `Save ${chosen.length}`}</button>
      </div>
      {(p.warnings.length > 0 || result) && (
        <div className="space-y-1 border-b border-line px-4 py-3 text-[13px]">
          {p.warnings.map((w) => <p key={w} className="text-warn">{w}</p>)}
          {result && "ok" in result && <p className="font-medium text-gain">{result.ok}</p>}
          {result && "error" in result && <p className="text-loss">{result.error}</p>}
        </div>
      )}
      <div className="max-h-[520px] overflow-auto">
        {records.kind === "fixed" ? (
          <table>
            <thead className="sticky top-0 bg-panel"><tr><th /><th>Name</th><th>Type</th><th className="r">Amount</th><th className="r">Rate</th><th>Start</th><th>Matures</th><th className="r">Balance</th></tr></thead>
            <tbody>{records.preview.rows.map((r, i) => (
              <tr key={i} className={excluded.has(i) ? "opacity-45" : undefined}>{check(i)}
                <td className="max-w-[260px]"><div className="truncate">{r.name}</div><div className="text-[11px] text-ink-3">{r.institution ?? ""}{r.assetClass ? ` · counts as ${r.assetClass.replace("_", " ")}` : ""}</div></td>
                <td>{KIND_LABEL[r.kind]}{r.payout ? " (payout)" : ""}</td>
                <td className="r num">{r.principal ? fmt(r.principal) : "—"}</td>
                <td className="r num">{r.ratePct ? `${r.ratePct}% ${r.compounding.replace("_", "-")}` : "—"}</td>
                <td className="num">{r.startDate}</td><td className="num">{r.maturityDate ?? "—"}</td>
                <td className="r num">{r.balance != null ? <>{fmt(r.balance)}<div className="text-[11px] text-ink-3">as of {r.balanceAsOf}</div></> : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <table>
            <thead className="sticky top-0 bg-panel"><tr><th /><th>Loan</th><th className="r">Principal</th><th className="r">Rate</th><th className="r">Tenure</th><th>First EMI</th><th>Prepayments / rate changes</th></tr></thead>
            <tbody>{records.preview.rows.map((r, i) => (
              <tr key={i} className={excluded.has(i) ? "opacity-45" : undefined}>{check(i)}
                <td className="max-w-[240px]"><div className="truncate">{r.name}</div><div className="text-[11px] text-ink-3">{r.principal ? `${r.kind}${r.lender ? ` · ${r.lender}` : ""}` : "events for an existing loan"}</div></td>
                <td className="r num">{r.principal ? fmt(r.principal) : "—"}</td>
                <td className="r num">{r.principal ? `${r.ratePct}%` : "—"}</td>
                <td className="r num">{r.tenureMonths ? `${r.tenureMonths} mo` : "—"}</td>
                <td className="num">{r.firstEmiDate || "—"}</td>
                <td className="text-[12px] text-ink-2">{r.events.length ? r.events.map((e) => `${e.date}: ${e.kind === "prepayment" ? `prepaid ${fmt(e.amount ?? 0)}` : `rate → ${e.ratePct}%`}`).join("; ") : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <Skipped skipped={p.skipped} />
    </div>
  );
}
