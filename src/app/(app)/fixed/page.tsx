import { requireCtx } from "@/lib/auth/session";
import { getFixedAssets, type FixedView } from "@/lib/portfolio/consolidated";
import { FIXED_INCOME_KINDS, KIND_LABEL } from "@/lib/calc/fixed";
import { addDays, todayIST } from "@/lib/calc/dates";
import { PageHeader, Stat, Card, Badge, Empty, Notice, btnGhost, btnDanger, classLabel } from "@/components/ui";
import { compact, fmtDate, money, signedMoney, tone } from "@/lib/format";
import { closeFixed, deleteFixed, updateBalance } from "./actions";
import { AddFixedForm } from "./add-form";

export const metadata = { title: "Fixed income & alternatives" };

function AssetTable({ rows, household, canManage, today }: { rows: FixedView[]; household: boolean; canManage: boolean; today: string }) {
  return (
    <div className="overflow-x-auto"><table>
      <thead><tr><th>Holding</th>{household && <th>Profile</th>}<th className="r">Rate</th><th>Since</th><th>Matures</th><th className="r">Invested</th><th className="r">Value today</th><th className="r">At maturity</th><th /></tr></thead>
      <tbody>{rows.map(({ asset: a, profileName, now, maturity, assetClass }) => {
        const gain = now.invested != null ? now.value - now.invested : null;
        const byBalance = a.balance != null;
        return (
          <tr key={a.id} className={a.closedOn ? "opacity-60" : "hover:bg-panel-2"}>
            <td className="max-w-[280px]">
              <div className="truncate font-medium">{a.name}</div>
              <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <span className="truncate">{KIND_LABEL[a.kind]}{a.institution ? ` · ${a.institution}` : ""}</span>
                {a.assetClass && <Badge>{classLabel(assetClass)}</Badge>}
                {a.closedOn ? <Badge>closed {fmtDate(a.closedOn)}</Badge> : now.matured ? <Badge kind="warn">matured</Badge> : null}
              </div>
            </td>
            {household && <td className="text-ink-2">{profileName}</td>}
            <td className="r num">{Number(a.ratePct) ? `${Number(a.ratePct)}%` : "—"}<div className="text-[11px] text-ink-3">{a.payout ? "paid out" : a.compounding.replace("_", "-")}</div></td>
            <td className="num whitespace-nowrap">{fmtDate(a.startDate)}</td>
            <td className="num whitespace-nowrap">{fmtDate(a.maturityDate)}</td>
            <td className="r num">{now.invested != null ? money(now.invested) : <span className="text-ink-3" title="Tracked from a balance">—</span>}</td>
            <td className="r num font-medium">{money(now.value)}
              <div className={`text-[11px] ${byBalance ? "text-ink-3" : tone(gain)}`}>{byBalance ? `balance ${fmtDate(a.balanceAsOf)}` : now.income ? `+${money(now.income)} paid out` : gain ? signedMoney(gain) : ""}</div>
            </td>
            <td className="r num">{maturity != null ? money(maturity) : "—"}</td>
            <td className="r">
              {canManage && (
                <div className="flex justify-end gap-1.5">
                  {byBalance && !a.closedOn && (
                    <details className="relative">
                      <summary className={`${btnGhost} cursor-pointer list-none`}>Update</summary>
                      <form action={updateBalance} className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-2 rounded-lg border border-line bg-panel p-3 shadow-lg">
                        <input type="hidden" name="id" value={a.id} />
                        <label>New balance (₹)<input name="balance" type="number" min="0" step="any" required className="mt-1 w-full" /></label>
                        <label>As of<input name="asOf" type="date" max={today} defaultValue={today} className="mt-1 w-full" /></label>
                        <button className={btnGhost}>Save balance</button>
                      </form>
                    </details>
                  )}
                  <form action={closeFixed}><input type="hidden" name="id" value={a.id} />{a.closedOn && <input type="hidden" name="reopen" value="1" />}<button className={btnGhost} title={a.closedOn ? "Count it again" : "Matured or withdrawn: stop counting it"}>{a.closedOn ? "Reopen" : "Close"}</button></form>
                  <form action={deleteFixed}><input type="hidden" name="id" value={a.id} /><button className={btnDanger}>Delete</button></form>
                </div>
              )}
            </td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

export default async function FixedPage() {
  const ctx = await requireCtx("other");
  const today = todayIST();
  const all = await getFixedAssets(ctx.profileIds, today);
  const live = all.filter((f) => !f.asset.closedOn);
  const fixedIncome = all.filter((f) => FIXED_INCOME_KINDS.includes(f.asset.kind));
  const alternatives = all.filter((f) => !FIXED_INCOME_KINDS.includes(f.asset.kind));
  const sum = (rows: FixedView[]) => rows.filter((f) => !f.asset.closedOn).reduce((s, f) => s + f.now.value, 0);
  const soon = live.filter((f) => f.asset.maturityDate && f.asset.maturityDate >= addDays(today, -30) && f.asset.maturityDate <= addDays(today, 90))
    .sort((a, b) => a.asset.maturityDate!.localeCompare(b.asset.maturityDate!));
  const canAdd = ctx.canManage && ctx.scope !== "household" && !!ctx.scope;
  const household = ctx.scope === "household";

  return (
    <>
      <PageHeader title="Fixed income & alternatives" sub="FDs, RDs, bonds, PPF, EPF and NPS, plus gold, REITs and cash. Values are accrued from each one's rate and dates (banks round broken periods slightly differently)." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fixed income" value={compact(sum(fixedIncome))} sub={`${fixedIncome.filter((f) => !f.asset.closedOn).length} holdings`} />
        <Stat label="Alternatives" value={compact(sum(alternatives))} sub={`${alternatives.filter((f) => !f.asset.closedOn).length} holdings`} />
        <Stat label="Maturing in 90 days" value={compact(soon.filter((f) => f.asset.maturityDate! >= today).reduce((s, f) => s + (f.maturity ?? 0), 0))} sub={`${soon.filter((f) => f.asset.maturityDate! >= today).length} maturities`} />
        <Stat label="Interest paid out to date" value={compact(live.reduce((s, f) => s + f.now.income, 0))} sub="payout FDs, bonds, SGB coupons" />
      </div>

      {soon.length > 0 && (
        <Card title="Maturity register: last 30 and next 90 days" className="mt-4" pad={false}>
          <ul className="divide-y divide-line">
            {soon.map((f) => (
              <li key={f.asset.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 truncate"><b>{f.asset.name}</b>{f.asset.institution ? ` · ${f.asset.institution}` : ""}{household ? <span className="text-ink-3"> · {f.profileName}</span> : null}</span>
                <span className="num flex items-center gap-2">{f.asset.maturityDate! < today ? <Badge kind="warn">matured {fmtDate(f.asset.maturityDate)}: renew or close</Badge> : fmtDate(f.asset.maturityDate)} <b>{money(f.maturity)}</b></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!all.length ? <div className="mt-4"><Empty title="Nothing here yet">Add your deposits, provident funds, gold and cash below so net worth covers everything.</Empty></div> : (
        <>
          {fixedIncome.length > 0 && <Card title="Fixed income" className="mt-4" pad={false}><AssetTable rows={fixedIncome} household={household} canManage={ctx.canManage} today={today} /></Card>}
          {alternatives.length > 0 && <Card title="Alternatives" className="mt-4" pad={false}><AssetTable rows={alternatives} household={household} canManage={ctx.canManage} today={today} /></Card>}
        </>
      )}

      <Card title="Add a holding" className="mt-4">
        {canAdd ? <AddFixedForm today={today} /> : <Notice kind="info">{household ? "Switch to a single profile to add a holding." : "You have view-only access to this profile."}</Notice>}
      </Card>
    </>
  );
}
