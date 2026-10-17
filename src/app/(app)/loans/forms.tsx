"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { addLoan, addLoanEvent } from "./actions";

function Result({ state }: { state: { error: string } | { ok: string } | null }) {
  return <>
    {state && "error" in state && <span className="text-[13px] text-loss">{state.error}</span>}
    {state && "ok" in state && <span className="text-[13px] text-gain">{state.ok}</span>}
  </>;
}

export function AddLoanForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addLoan, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state && "ok" in state) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1"><label htmlFor="lkind">Type</label>
        <select id="lkind" name="kind" defaultValue="home"><option value="home">Home loan</option><option value="car">Car loan</option><option value="personal">Personal loan</option><option value="education">Education loan</option><option value="gold">Gold loan</option><option value="other">Other</option></select>
      </div>
      <div className="flex flex-col gap-1"><label htmlFor="lname">Name</label><input id="lname" name="name" required maxLength={120} placeholder="e.g. Flat in Pune" /></div>
      <div className="flex flex-col gap-1"><label htmlFor="lender">Lender</label><input id="lender" name="lender" maxLength={120} /></div>
      <div className="flex flex-col gap-1"><label htmlFor="lp">Amount borrowed (₹)</label><input id="lp" name="principal" type="number" min="1" step="any" required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="lr">Interest % a year</label><input id="lr" name="ratePct" type="number" min="0" max="50" step="any" required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="lt">Tenure (months)</label><input id="lt" name="tenureMonths" type="number" min="1" max="600" required placeholder="240 = 20 years" /></div>
      <div className="flex flex-col gap-1"><label htmlFor="lf">First EMI date</label><input id="lf" name="firstEmiDate" type="date" defaultValue={today} required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="le">EMI (₹, optional)</label><input id="le" name="emi" type="number" min="1" step="any" placeholder="computed if blank" /></div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
        <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Saving…" : "Add loan"}</button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function LoanEventForm({ loanId, today }: { loanId: string; today: string }) {
  const [state, action, pending] = useActionState(addLoanEvent, null);
  const [kind, setKind] = useState("prepayment");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state && "ok" in state) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="loanId" value={loanId} />
      <div className="flex flex-col gap-1"><label htmlFor="ek">What happened</label>
        <select id="ek" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="prepayment">Prepayment</option><option value="rate_change">Interest rate changed</option></select>
      </div>
      <div className="flex flex-col gap-1"><label htmlFor="ed">Date</label><input id="ed" name="date" type="date" defaultValue={today} required /></div>
      {kind === "prepayment"
        ? <div className="flex flex-col gap-1"><label htmlFor="ea">Amount (₹)</label><input id="ea" name="amount" type="number" min="1" step="any" required /></div>
        : <div className="flex flex-col gap-1"><label htmlFor="er">New rate %</label><input id="er" name="ratePct" type="number" min="0" max="50" step="any" required /></div>}
      <div className="flex flex-col gap-1"><label htmlFor="ere">Lender adjusts</label>
        <select id="ere" name="reduce" defaultValue="tenure"><option value="tenure">Tenure (EMI unchanged)</option><option value="emi">EMI (same end date)</option></select>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2"><button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Saving…" : "Record"}</button><Result state={state} /></div>
    </form>
  );
}
