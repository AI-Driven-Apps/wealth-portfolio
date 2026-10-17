"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { addFixed } from "./actions";

const KINDS = [
  ["fd", "Fixed deposit"], ["rd", "Recurring deposit"], ["bond", "Bond / NCD"], ["ppf", "PPF"], ["epf", "EPF"], ["nps", "NPS"],
  ["sgb", "Sovereign gold bond"], ["gold", "Physical / digital gold"], ["reit", "REIT / InvIT"], ["cash", "Cash / savings"], ["other", "Other"],
] as const;
// Kinds usually tracked from a statement balance rather than from a deposit's terms.
const BALANCE_KINDS = new Set(["ppf", "epf", "nps", "gold", "reit", "cash", "other"]);
const DEFAULTS: Record<string, { rate?: string; comp: string; payout?: boolean }> = {
  fd: { comp: "quarterly" }, rd: { comp: "quarterly" }, bond: { comp: "half_yearly", payout: true }, ppf: { rate: "7.1", comp: "yearly" },
  epf: { rate: "8.25", comp: "yearly" }, nps: { comp: "yearly" }, sgb: { rate: "2.5", comp: "half_yearly", payout: true },
  gold: { rate: "0", comp: "yearly" }, reit: { comp: "yearly" }, cash: { rate: "3", comp: "quarterly" }, other: { comp: "yearly" },
};

export function AddFixedForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addFixed, null);
  const [kind, setKind] = useState("fd");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state && "ok" in state) formRef.current?.reset(); }, [state]);
  const d = DEFAULTS[kind];
  const byBalance = BALANCE_KINDS.has(kind);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" key={kind}>
      <div className="flex flex-col gap-1"><label htmlFor="kind">Type</label>
        <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <div className="flex flex-col gap-1"><label htmlFor="fname">Name</label><input id="fname" name="name" required maxLength={120} placeholder={kind === "fd" ? "e.g. SBI FD 2 years" : ""} /></div>
      <div className="flex flex-col gap-1"><label htmlFor="inst">Bank / issuer</label><input id="inst" name="institution" maxLength={120} /></div>
      <div className="flex flex-col gap-1"><label htmlFor="start">{kind === "rd" ? "First instalment" : byBalance ? "Opened on" : "Start date"}</label><input id="start" name="startDate" type="date" max={today} defaultValue={today} required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="principal">{kind === "rd" ? "Monthly instalment (₹)" : byBalance ? "Amount invested (₹, optional)" : "Amount invested (₹)"}</label><input id="principal" name="principal" type="number" min="0" step="any" required={!byBalance} /></div>
      <div className="flex flex-col gap-1"><label htmlFor="rate">{kind === "sgb" || kind === "bond" ? "Coupon % a year" : "Interest / growth % a year"}</label><input id="rate" name="ratePct" type="number" min="0" max="50" step="any" defaultValue={d.rate ?? ""} placeholder="e.g. 7.1" /></div>
      <div className="flex flex-col gap-1"><label htmlFor="comp">Compounding</label>
        <select id="comp" name="compounding" defaultValue={d.comp}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half-yearly</option><option value="yearly">Yearly</option><option value="simple">Simple interest</option></select>
      </div>
      <div className="flex flex-col gap-1"><label htmlFor="mat">Maturity date{kind === "rd" ? "" : " (optional)"}</label><input id="mat" name="maturityDate" type="date" required={kind === "rd"} /></div>
      {byBalance && <>
        <div className="flex flex-col gap-1"><label htmlFor="bal">Current balance (₹)</label><input id="bal" name="balance" type="number" min="0" step="any" placeholder="from your latest statement" /></div>
        <div className="flex flex-col gap-1"><label htmlFor="balAsOf">Balance as of</label><input id="balAsOf" name="balanceAsOf" type="date" max={today} defaultValue={today} /></div>
      </>}
      <div className="flex flex-col gap-1"><label htmlFor="cls">Counts as</label>
        <select id="cls" name="assetClass" defaultValue=""><option value="">Default for this type</option><option value="equity">Equity (e.g. NPS equity)</option><option value="debt">Debt</option><option value="gold">Gold</option><option value="real_estate">Real estate</option><option value="cash">Cash</option><option value="other">Other</option></select>
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink"><input type="checkbox" name="payout" defaultChecked={d.payout} className="h-4 w-4" /> Interest is paid out (not reinvested)</label>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Saving…" : "Add"}</button>
        {state && "error" in state && <span className="text-[13px] text-loss">{state.error}</span>}
        {state && "ok" in state && <span className="text-[13px] text-gain">{state.ok}</span>}
        <span className="text-[12px] text-ink-3">{byBalance ? "Enter the balance from your passbook/statement; it grows at the rate until you update it." : "Value today is accrued from these terms."}</span>
      </div>
    </form>
  );
}
