import { addMonths } from "./dates";

// Reducing-balance loans with monthly EMIs, the way Indian lenders amortise
// them. Events (prepayments, rate changes) apply before the EMI they precede
// and either shorten the tenure (EMI unchanged, the lender default) or reset
// the EMI over the remaining original tenure.

export interface LoanInput {
  principal: number;
  ratePct: number;
  tenureMonths: number;
  emi?: number | null;   // as the lender set it; computed when absent
  firstEmiDate: string;
}

export interface LoanEvent {
  date: string;
  kind: "prepayment" | "rate_change";
  amount?: number | null;
  ratePct?: number | null;
  reduce: "tenure" | "emi";
}

export interface ScheduleRow {
  n: number; date: string; ratePct: number;
  opening: number; prepayment: number; emi: number; interest: number; principal: number; closing: number;
}

export function emiFor(principal: number, ratePct: number, months: number): number {
  if (!(principal > 0) || !(months > 0)) return 0;
  const i = ratePct / 1200;
  if (i === 0) return principal / months;
  const f = Math.pow(1 + i, months);
  return (principal * i * f) / (f - 1);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function amortise(loan: LoanInput, events: LoanEvent[] = []): ScheduleRow[] {
  const evs = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const rows: ScheduleRow[] = [];
  let bal = loan.principal, rate = loan.ratePct;
  let emi = loan.emi && loan.emi > 0 ? loan.emi : emiFor(loan.principal, rate, loan.tenureMonths);
  let ei = 0;
  for (let n = 1; n <= 1200 && bal > 0.005; n++) {
    const date = addMonths(loan.firstEmiDate, n - 1);
    const remaining = Math.max(loan.tenureMonths - (n - 1), 1);
    const opening = bal;
    let prepayment = 0;
    while (ei < evs.length && evs[ei].date <= date) {
      const e = evs[ei++];
      if (e.kind === "prepayment" && e.amount && e.amount > 0) {
        const p = Math.min(e.amount, bal);
        bal -= p; prepayment += p;
      } else if (e.kind === "rate_change" && e.ratePct != null) {
        rate = e.ratePct;
      }
      if (e.reduce === "emi") emi = emiFor(bal, rate, remaining);
    }
    if (bal <= 0.005) { rows.push({ n, date, ratePct: rate, opening, prepayment, emi: 0, interest: 0, principal: 0, closing: 0 }); break; }
    const interest = bal * (rate / 1200);
    // An EMI that no longer covers the interest would grow the loan; lenders raise it instead.
    if (emi <= interest + 0.01) emi = emiFor(bal, rate, remaining);
    const pay = Math.min(emi, bal + interest);
    const principal = pay - interest;
    const closing = bal - principal;
    rows.push({ n, date, ratePct: rate, opening, prepayment, emi: pay, interest, principal, closing: closing < 0.005 ? 0 : closing });
    bal = closing;
  }
  return rows;
}

export interface LoanStatus {
  outstanding: number; paidCount: number; leftCount: number;
  interestPaid: number; principalPaid: number; prepaid: number;
  totalInterest: number; currentEmi: number; payoffDate: string | null; nextEmiDate: string | null;
}

/** Position on `today`, assuming every EMI up to today was paid on schedule. */
export function loanStatus(loan: LoanInput, schedule: ScheduleRow[], today: string): LoanStatus {
  const paid = schedule.filter((r) => r.date <= today);
  const left = schedule.filter((r) => r.date > today && r.emi > 0);
  const last = paid[paid.length - 1];
  return {
    outstanding: round2(last ? last.closing : loan.principal),
    paidCount: paid.filter((r) => r.emi > 0).length,
    leftCount: left.length,
    interestPaid: paid.reduce((s, r) => s + r.interest, 0),
    principalPaid: paid.reduce((s, r) => s + r.principal + r.prepayment, 0),
    prepaid: paid.reduce((s, r) => s + r.prepayment, 0),
    totalInterest: schedule.reduce((s, r) => s + r.interest, 0),
    currentEmi: (left[0] ?? last)?.emi ?? 0,
    payoffDate: schedule.filter((r) => r.emi > 0 || r.prepayment > 0).at(-1)?.date ?? null,
    nextEmiDate: left[0]?.date ?? null,
  };
}

/** Outstanding principal on any date; before the first EMI the full principal is owed. */
export function outstandingOn(loan: LoanInput, schedule: ScheduleRow[], on: string): number {
  let bal = loan.principal;
  for (const r of schedule) { if (r.date > on) break; bal = r.closing; }
  return bal;
}

/** What the prepayments bought you: compares against the same loan with only its rate changes. */
export function prepaymentImpact(loan: LoanInput, events: LoanEvent[]) {
  const withPre = amortise(loan, events);
  const without = amortise(loan, events.filter((e) => e.kind !== "prepayment"));
  const interest = (s: ScheduleRow[]) => s.reduce((a, r) => a + r.interest, 0);
  const months = (s: ScheduleRow[]) => s.filter((r) => r.emi > 0).length;
  return {
    interestSaved: interest(without) - interest(withPre),
    monthsSaved: months(without) - months(withPre),
    prepaid: withPre.reduce((a, r) => a + r.prepayment, 0),
    baseline: without,
  };
}
