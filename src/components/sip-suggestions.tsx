"use client";
import { useActionState } from "react";
import { createDetectedSips } from "@/app/(app)/sip/actions";
import type { SipCandidate } from "@/lib/portfolio/sips";

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const date = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** Monthly purchase runs found in the ledger, offered as SIP plans to create in one go. */
export function SipSuggestions({ candidates }: { candidates: SipCandidate[] }) {
  const [state, action, pending] = useActionState(createDetectedSips, null);
  if (!candidates.length) return null;
  const done = !!(state && "ok" in state);
  return (
    <form action={action} className="space-y-3">
      <p className="text-[13px] text-ink-2">These look like SIPs: one purchase a month on about the same day. Add them as plans so due dates and missed instalments are tracked.</p>
      <div className="overflow-x-auto"><table>
        <thead><tr><th className="w-8" /><th>Fund</th><th className="r">Amount</th><th>Day</th><th>Step-up</th><th>Since</th><th>Status</th><th className="r" title="Instalments found / share of expected ones that match a purchase">Found</th></tr></thead>
        <tbody>{candidates.map((c) => {
          const key = `${c.instrumentId}|${c.accountId ?? ""}`;
          return (
            <tr key={key}>
              <td><input type="checkbox" name="pick" value={key} defaultChecked={c.plan.active} aria-label={`Add SIP in ${c.instrumentName}`} className="h-4 w-4" disabled={done} /></td>
              <td className="max-w-[320px]"><div className="truncate">{c.instrumentName}</div>{c.accountLabel && <div className="text-[11px] text-ink-3">{c.accountLabel}</div>}</td>
              <td className="r num">{inr(c.plan.amount)}</td>
              <td className="num">{c.plan.dayOfMonth}</td>
              <td className="num">{c.plan.stepUpPct ? `+${c.plan.stepUpPct}%/yr` : "—"}</td>
              <td className="num whitespace-nowrap">{date(c.plan.startDate)}</td>
              <td>{c.plan.active ? <span className="text-gain">running</span> : <span className="text-ink-3">stopped {date(c.plan.endDate!)}</span>}</td>
              <td className="r num">{c.plan.instalments} · {Math.round(c.plan.fit * 100)}%</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <div className="flex items-center gap-3">
        <button disabled={pending || done} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Adding…" : "Add ticked SIPs"}</button>
        {state && "error" in state && <span className="text-[13px] text-loss">{state.error}</span>}
        {done && <span className="text-[13px] font-medium text-gain">{(state as { ok: string }).ok}</span>}
      </div>
    </form>
  );
}
