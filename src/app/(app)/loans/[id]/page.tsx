import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/auth/session";
import { getLoans } from "@/lib/portfolio/consolidated";
import { todayIST } from "@/lib/calc/dates";
import { CompareChart } from "@/components/charts";
import { PageHeader, Stat, Card, Badge, btnGhost, btnDanger } from "@/components/ui";
import { compact, fmtDate, money } from "@/lib/format";
import { closeLoan, deleteLoan, deleteLoanEvent } from "../actions";
import { LoanEventForm } from "../forms";

export const metadata = { title: "Loan" };

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireCtx("loans");
  const today = todayIST();
  const [l] = await getLoans(ctx.profileIds, today, id);
  if (!l) notFound();
  const { status: st, impact } = l;

  // Balance with your prepayments vs the same loan without them, sampled monthly.
  const base = new Map(impact.baseline.map((r) => [r.date, r.closing]));
  const dates = [...new Set([...l.schedule.map((r) => r.date), ...impact.baseline.map((r) => r.date)])].sort();
  let lastA = l.input.principal, lastB = l.input.principal;
  const own = new Map(l.schedule.map((r) => [r.date, r.closing]));
  const chart = [{ date: dates[0] ? dates[0].slice(0, 8) + "01" : today, a: l.input.principal, b: l.input.principal }, ...dates.map((d) => {
    lastA = own.get(d) ?? (d > (l.schedule.at(-1)?.date ?? "") ? 0 : lastA);
    lastB = base.get(d) ?? lastB;
    return { date: d, a: lastA, b: lastB };
  })];

  // Yearly summary (calendar years) of what went where.
  const years = new Map<string, { interest: number; principal: number; prepaid: number; closing: number }>();
  for (const r of l.schedule) {
    const y = r.date.slice(0, 4);
    const e = years.get(y) ?? { interest: 0, principal: 0, prepaid: 0, closing: 0 };
    e.interest += r.interest; e.principal += r.principal; e.prepaid += r.prepayment; e.closing = r.closing;
    years.set(y, e);
  }
  const canManage = ctx.canManage && ctx.scope !== "household";
  const thisYear = today.slice(0, 4);

  return (
    <>
      <PageHeader title={l.loan.name} sub={<span className="flex flex-wrap items-center gap-1.5">{l.loan.lender && <span>{l.loan.lender}</span>}<Badge>{l.loan.kind} loan</Badge><span className="num">{money(l.input.principal)} at {Number(l.loan.ratePct)}% for {l.loan.tenureMonths} months from {fmtDate(l.loan.firstEmiDate)}</span>{l.loan.closedOn && <Badge>closed {fmtDate(l.loan.closedOn)}</Badge>}</span>}
        actions={canManage ? <>
          <form action={closeLoan}><input type="hidden" name="id" value={l.loan.id} />{l.loan.closedOn && <input type="hidden" name="reopen" value="1" />}<button className={btnGhost}>{l.loan.closedOn ? "Reopen" : "Mark closed"}</button></form>
          <form action={deleteLoan}><input type="hidden" name="id" value={l.loan.id} /><button className={btnDanger}>Delete</button></form>
        </> : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding" value={money(st.outstanding)} sub={`${st.paidCount} EMIs paid, ${st.leftCount} left`} />
        <Stat label="Current EMI" value={money(st.currentEmi)} sub={st.nextEmiDate ? `next ${fmtDate(st.nextEmiDate)}` : "no EMIs left"} />
        <Stat label="Interest paid / total" value={<span className="text-[17px]">{compact(st.interestPaid)} / {compact(st.totalInterest)}</span>} sub={`principal repaid ${compact(st.principalPaid)}`} />
        <Stat label="Prepayments" value={compact(impact.prepaid)} sub={impact.prepaid ? `save ${compact(impact.interestSaved)} interest${impact.monthsSaved ? `, ${impact.monthsSaved} EMIs` : ""}` : "none recorded"} subTone={impact.interestSaved || undefined} />
      </div>

      <Card title="Outstanding balance" className="mt-4">
        <CompareChart data={chart} aLabel={impact.prepaid ? "With your prepayments" : "Outstanding"} bLabel={impact.prepaid ? "Without prepayments" : "Original schedule"} />
        <p className="mt-2 text-[12px] text-ink-3">Payoff {fmtDate(st.payoffDate)}{impact.monthsSaved ? `, ${impact.monthsSaved} months earlier than without prepayments` : ""}.</p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card title="Prepayments and rate changes" pad={false}>
          {!l.events.length ? <p className="px-4 py-4 text-[13px] text-ink-3">None recorded.</p> : (
            <table>
              <thead><tr><th>Date</th><th>Event</th><th>Lender adjusted</th><th /></tr></thead>
              <tbody>{l.events.map((e) => (
                <tr key={e.id}>
                  <td className="num whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td>{e.kind === "prepayment" ? `Prepaid ${money(Number(e.amount))}` : `Rate → ${Number(e.ratePct)}%`}</td>
                  <td className="text-ink-2">{e.reduce === "emi" ? "EMI" : "tenure"}</td>
                  <td className="r">{canManage && <form action={deleteLoanEvent}><input type="hidden" name="loanId" value={l.loan.id} /><input type="hidden" name="id" value={e.id} /><button className={btnDanger}>Delete</button></form>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {canManage && <div className="border-t border-line p-4"><LoanEventForm loanId={l.loan.id} today={today} /></div>}
        </Card>
        <Card title="Year by year" pad={false}>
          <div className="max-h-[420px] overflow-auto"><table>
            <thead><tr><th>Year</th><th className="r">Interest</th><th className="r">Principal</th><th className="r">Prepaid</th><th className="r">Balance at end</th></tr></thead>
            <tbody>{[...years.entries()].map(([y, e]) => (
              <tr key={y} className={y === thisYear ? "bg-accent-soft" : undefined}>
                <td className="num">{y}{y < thisYear ? "" : y === thisYear ? " (now)" : ""}</td>
                <td className="r num">{money(e.interest)}</td>
                <td className="r num">{money(e.principal)}</td>
                <td className="r num">{e.prepaid ? money(e.prepaid) : "—"}</td>
                <td className="r num">{money(e.closing)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      </div>
    </>
  );
}
