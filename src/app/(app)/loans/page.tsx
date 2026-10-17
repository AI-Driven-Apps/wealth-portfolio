import Link from "next/link";
import { requireCtx } from "@/lib/auth/session";
import { getLoans } from "@/lib/portfolio/consolidated";
import { todayIST } from "@/lib/calc/dates";
import { PageHeader, Stat, Card, Badge, Empty, Notice } from "@/components/ui";
import { compact, fmtDate, money } from "@/lib/format";
import { AddLoanForm } from "./forms";

export const metadata = { title: "Loans & EMIs" };

const KIND: Record<string, string> = { home: "Home", car: "Car", personal: "Personal", education: "Education", gold: "Gold", other: "Other" };

export default async function LoansPage() {
  const ctx = await requireCtx("loans");
  const today = todayIST();
  const loans = await getLoans(ctx.profileIds, today);
  const live = loans.filter((l) => l.status.outstanding > 0);
  const canAdd = ctx.canManage && ctx.scope !== "household" && !!ctx.scope;

  return (
    <>
      <PageHeader title="Loans & EMIs" sub="Reducing-balance amortisation from each loan's terms, assuming EMIs are paid on schedule. Record prepayments and rate changes to keep it exact." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding" value={compact(live.reduce((s, l) => s + l.status.outstanding, 0))} sub={`${live.length} active loan${live.length === 1 ? "" : "s"}`} />
        <Stat label="EMIs each month" value={money(live.reduce((s, l) => s + l.status.currentEmi, 0))} />
        <Stat label="Interest paid so far" value={compact(loans.reduce((s, l) => s + l.status.interestPaid, 0))} />
        <Stat label="Interest saved by prepaying" value={<span className="text-gain">{compact(loans.reduce((s, l) => s + l.impact.interestSaved, 0))}</span>} sub={loans.some((l) => l.impact.monthsSaved) ? `${loans.reduce((s, l) => s + l.impact.monthsSaved, 0)} EMIs fewer` : undefined} />
      </div>
      {!loans.length ? <div className="mt-4"><Empty title="No loans">Add a loan below to track what's left, interest paid and the effect of prepaying.</Empty></div> : (
        <Card title="Loans" className="mt-4" pad={false}>
          <div className="overflow-x-auto"><table>
            <thead><tr><th>Loan</th>{ctx.scope === "household" && <th>Profile</th>}<th className="r">Rate</th><th className="r">EMI</th><th className="r">Paid / left</th><th className="r">Outstanding</th><th className="r">Interest paid</th><th>Ends</th></tr></thead>
            <tbody>{loans.map((l) => (
              <tr key={l.loan.id} className="hover:bg-panel-2">
                <td className="max-w-[280px]"><Link href={`/loans/${l.loan.id}`} className="block truncate font-medium hover:underline">{l.loan.name}</Link>
                  <div className="flex items-center gap-1.5 text-[12px] text-ink-3">{KIND[l.loan.kind]}{l.loan.lender ? ` · ${l.loan.lender}` : ""}{l.loan.closedOn ? <Badge>closed</Badge> : !l.status.outstanding ? <Badge kind="accent">paid off</Badge> : null}</div></td>
                {ctx.scope === "household" && <td className="text-ink-2">{l.profileName}</td>}
                <td className="r num">{l.schedule.find((r) => r.date > today)?.ratePct ?? Number(l.loan.ratePct)}%</td>
                <td className="r num">{money(l.status.currentEmi)}</td>
                <td className="r num">{l.status.paidCount} / {l.status.leftCount}</td>
                <td className="r num font-medium">{money(l.status.outstanding)}</td>
                <td className="r num">{money(l.status.interestPaid)}</td>
                <td className="num whitespace-nowrap">{fmtDate(l.status.payoffDate)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
      <Card title="Add a loan" className="mt-4">
        {canAdd ? <AddLoanForm today={today} /> : <Notice kind="info">{ctx.scope === "household" ? "Switch to a single profile to add a loan." : "You have view-only access to this profile."}</Notice>}
      </Card>
    </>
  );
}
