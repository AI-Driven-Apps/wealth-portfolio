"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { addTxn } from "./actions";

interface Hit { id: number; name: string; type: string; nseSymbol: string | null; amfiCode: string | null; plan: string | null }

export function AddTxnForm({ basePath, today }: { basePath: string; today: string }) {
  const [state, action, pending] = useActionState(addTxn, null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [type, setType] = useState("buy");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (picked || q.trim().length < 2) { setHits([]); return; }
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`${basePath}/api/instruments?q=${encodeURIComponent(q)}`, { signal: c.signal }).then((r) => r.json()).then(setHits).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); c.abort(); };
  }, [q, picked, basePath]);

  useEffect(() => { if (state && "ok" in state) { formRef.current?.reset(); setPicked(null); setQ(""); } }, [state]);

  const isSplit = type === "split", isDiv = type === "dividend_payout", isBonus = type === "bonus";
  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="relative flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
        <label htmlFor="ins">Fund, stock or ETF</label>
        <input id="ins" autoComplete="off" placeholder="Search name, NSE symbol, AMFI code or ISIN" value={picked ? (picked.nseSymbol ? `${picked.nseSymbol} · ${picked.name}` : picked.name) : q}
          onChange={(e) => { setPicked(null); setQ(e.target.value); }} />
        <input type="hidden" name="instrumentId" value={picked?.id ?? ""} />
        {hits.length > 0 && (
          <ul className="absolute top-full z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-panel shadow-lg">
            {hits.map((h) => (
              <li key={h.id}><button type="button" onClick={() => { setPicked(h); setHits([]); }} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-panel-2">
                <span className="font-medium">{h.nseSymbol && h.type !== "mf" ? `${h.nseSymbol} · ` : ""}{h.name}</span>
                <span className="ml-2 text-[11px] text-ink-3 uppercase">{h.type}{h.plan ? ` · ${h.plan}` : ""}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="type">Type</label>
        <select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="buy">Buy / lump sum</option><option value="sip">SIP instalment</option><option value="sell">Sell / redeem</option>
          <option value="switch_in">Switch in</option><option value="switch_out">Switch out</option>
          <option value="dividend_payout">Dividend received</option><option value="dividend_reinvest">Dividend reinvested</option>
          <option value="bonus">Bonus shares</option><option value="split">Stock split</option>
        </select>
      </div>
      <div className="flex flex-col gap-1"><label htmlFor="date">Date</label><input id="date" name="date" type="date" max={today} defaultValue={today} required /></div>
      <div className="flex flex-col gap-1">
        <label htmlFor="units">{isSplit ? "Ratio (new ÷ old)" : "Units"}</label>
        <input id="units" name="units" type="number" step="any" min="0" placeholder={isSplit ? "e.g. 5" : ""} defaultValue={isDiv ? 0 : undefined} disabled={isDiv} />
      </div>
      {!isSplit && !isBonus && !isDiv && <div className="flex flex-col gap-1"><label htmlFor="price">Price / NAV</label><input id="price" name="price" type="number" step="any" min="0" /></div>}
      {(isSplit || isBonus || isDiv) && <input type="hidden" name="price" value="0" />}
      {isDiv && <input type="hidden" name="units" value="0" />}
      {!isSplit && !isBonus && <div className="flex flex-col gap-1"><label htmlFor="amount">{isDiv ? "Amount received" : "Amount (optional)"}</label><input id="amount" name="amount" type="number" step="any" min="0" placeholder={isDiv ? "" : "units × price"} /></div>}
      {!isSplit && !isBonus && !isDiv && <div className="flex flex-col gap-1"><label htmlFor="fees">Charges</label><input id="fees" name="fees" type="number" step="any" min="0" defaultValue="0" /></div>}
      <div className="flex flex-col gap-1 sm:col-span-2"><label htmlFor="notes">Note</label><input id="notes" name="notes" maxLength={500} /></div>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-6">
        <button disabled={pending || !picked} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Saving…" : "Add transaction"}</button>
        {state && "error" in state && <span className="text-[13px] text-loss">{state.error}</span>}
        {state && "ok" in state && <span className="text-[13px] text-gain">{state.ok}</span>}
      </div>
    </form>
  );
}
