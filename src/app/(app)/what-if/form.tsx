"use client";
import { useState } from "react";
import { InstrumentPicker, type Hit } from "@/components/instrument-picker";

export interface Option { value: string; label: string; group?: string }

/** GET form: the result page is a plain URL, so a comparison can be bookmarked. */
export function WhatIfForm({ basePath, holdings, indices, init, initialAlt, today }: {
  basePath: string; holdings: Option[]; indices: Option[];
  init: { h: string; alt: string; altId: string; rate: string; stop: string };
  initialAlt: Hit | null; today: string;
}) {
  const [alt, setAlt] = useState(init.alt);
  const groups = [...new Set(holdings.map((o) => o.group ?? ""))];
  return (
    <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="h">Your money in</label>
        <select id="h" name="h" defaultValue={init.h}>
          {groups.map((g) => g
            ? <optgroup key={g} label={g}>{holdings.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
            : holdings.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="alt">What if it had gone into</label>
        <select id="alt" name="alt" value={alt} onChange={(e) => setAlt(e.target.value)}>
          <optgroup label="Another investment">
            {indices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="pick">A fund, ETF or stock…</option>
            <option value="fd">A fixed deposit</option>
          </optgroup>
          <optgroup label="Same holdings, different timing">
            <option value="lumpsum">All at once on the first day</option>
            <option value="stop">Stopped investing after a date</option>
          </optgroup>
        </select>
      </div>
      {alt === "pick" && <div className="sm:col-span-2"><InstrumentPicker basePath={basePath} name="altId" label="Alternative" withIndex initial={initialAlt} placeholder="Search a fund, ETF, index or stock" /></div>}
      {alt === "fd" && <div className="flex flex-col gap-1"><label htmlFor="rate">FD rate % a year</label><input id="rate" name="rate" type="number" min="0" max="20" step="any" defaultValue={init.rate || "7"} /></div>}
      {alt === "stop" && <div className="flex flex-col gap-1"><label htmlFor="stop">Stopped after</label><input id="stop" name="stop" type="date" max={today} defaultValue={init.stop} required /></div>}
      <div className="flex items-end sm:col-span-2 lg:col-span-4"><button className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink">Compare</button></div>
    </form>
  );
}
