"use client";
import { useEffect, useState } from "react";

export interface Hit { id: number; name: string; type: string; nseSymbol: string | null; plan: string | null }

/** Search-as-you-type picker that submits the instrument id in a hidden field. */
export function InstrumentPicker({ basePath, name = "instrumentId", onlyType, label = "Fund", withIndex, initial, placeholder = "Search by name or AMFI code", onPick }: {
  basePath: string; name?: string; onlyType?: string; label?: string; withIndex?: boolean; initial?: Hit | null; placeholder?: string;
  /** Called with the chosen instrument (or null when the text is edited again). */
  onPick?: (hit: Hit | null) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(initial ?? null);
  useEffect(() => {
    if (picked || q.trim().length < 2) { setHits([]); return; }
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`${basePath}/api/instruments?q=${encodeURIComponent(q)}${withIndex ? "&index=1" : ""}`, { signal: c.signal }).then((r) => r.json())
        .then((h: Hit[]) => setHits(onlyType ? h.filter((x) => x.type === onlyType) : h)).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); c.abort(); };
  }, [q, picked, basePath, onlyType, withIndex]);
  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={`${name}-q`}>{label}</label>
      <input id={`${name}-q`} autoComplete="off" placeholder={placeholder} value={picked ? picked.name : q} onChange={(e) => { if (picked) onPick?.(null); setPicked(null); setQ(e.target.value); }} />
      {!onPick && <input type="hidden" name={name} value={picked?.id ?? ""} required />}
      {hits.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-panel shadow-lg">
          {hits.map((h) => (
            <li key={h.id}><button type="button" onClick={() => { setPicked(h); setHits([]); onPick?.(h); }} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-panel-2">
              {h.name}<span className="ml-2 text-[11px] text-ink-3 uppercase">{h.plan ?? h.type}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
