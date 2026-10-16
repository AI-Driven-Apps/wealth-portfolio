"use client";
import { useActionState } from "react";
import { addSip } from "./actions";
import { InstrumentPicker } from "@/components/instrument-picker";

export function AddSipForm({ basePath, today }: { basePath: string; today: string }) {
  const [state, action, pending] = useActionState(addSip, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div className="sm:col-span-2"><InstrumentPicker basePath={basePath} onlyType="mf" /></div>
      <div className="flex flex-col gap-1"><label htmlFor="amount">Monthly amount (₹)</label><input id="amount" name="amount" type="number" min="100" step="any" required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="day">Day of month</label><input id="day" name="dayOfMonth" type="number" min="1" max="31" defaultValue="5" required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="step">Yearly step-up %</label><input id="step" name="stepUpPct" type="number" min="0" max="100" step="any" defaultValue="0" /></div>
      <div className="flex flex-col gap-1"><label htmlFor="start">Start date</label><input id="start" name="startDate" type="date" defaultValue={today} required /></div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-6">
        <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Saving…" : "Add SIP"}</button>
        {state && "error" in state && <span className="text-[13px] text-loss">{state.error}</span>}
        {state && "ok" in state && <span className="text-[13px] text-gain">{state.ok}</span>}
      </div>
    </form>
  );
}
