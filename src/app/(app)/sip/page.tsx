import Link from "next/link";
import clsx from "clsx";
import { requireCtx } from "@/lib/auth/session";
import { getSips, sipCandidates } from "@/lib/portfolio/sips";
import { SipSuggestions } from "@/components/sip-suggestions";
import { getHoldings } from "@/lib/portfolio/holdings";
import { config } from "@/lib/config";
import { todayIST } from "@/lib/calc/dates";
import { PageHeader, Card, Stat, Badge, Empty, Notice, btnGhost } from "@/components/ui";
import { money, compact, fmtDate, pct, tone } from "@/lib/format";
import { stopSip } from "./actions";
import { AddSipForm } from "./add-form";

export const metadata = { title: "SIPs" };

export default async function SipPage() {
  const ctx = await requireCtx("sip");
  const sips = await getSips(ctx.profileIds);
  const holdings = await getHoldings(ctx.profileIds, ["mf"], { includeClosed: true });
  const byIns = new Map(holdings.map((h) => [h.instrument.id, h]));
  const active = sips.filter((s) => s.plan.active);
  const monthly = active.reduce((s, x) => s + x.currentAmount, 0);
  const missed12 = sips.flatMap((s) => s.statuses.slice(-12)).filter((x) => x.status === "missed").length;
  const canAdd = ctx.canManage && ctx.scope !== "household" && !!ctx.scope;
  const candidates = canAdd ? await sipCandidates(ctx.scope) : [];

  return (
    <>
      <PageHeader title="SIPs" sub="Expected instalments are matched to purchases in your ledger (±7 days, ±5% for stamp duty), so a bounced or skipped SIP shows up here." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active SIPs" value={active.length} sub={`${sips.length - active.length} stopped`} />
        <Stat label="Going out each month" value={money(monthly)} sub="after step-ups" />
        <Stat label="Invested through SIPs" value={compact(sips.reduce((s, x) => s + x.investedViaSip, 0))} />
        <Stat label="Missed in last 12 months" value={<span className={missed12 ? "text-loss" : ""}>{missed12}</span>} sub={missed12 ? "check your bank mandate" : "none"} />
      </div>
      {!sips.length ? <div className="mt-4"><Empty title="No SIPs set up">Add your SIPs below so the app can track due dates and spot missed instalments.</Empty></div> : (
        <div className="mt-4 space-y-3">
          {sips.map((s) => {
            const h = byIns.get(s.instrument.id);
            const last12 = s.statuses.slice(-12);
            return (
              <Card key={s.plan.id} title={<Link href={`/holding/${s.instrument.id}`} className="hover:underline">{s.instrument.name}</Link>}
                actions={<div className="flex items-center gap-2">
                  {ctx.scope === "household" && <span className="text-[12px] text-ink-3">{s.profileName}</span>}
                  {s.plan.active ? <Badge kind="accent">Active</Badge> : <Badge>Stopped {fmtDate(s.plan.endDate)}</Badge>}
                  {ctx.canManage && <form action={stopSip}><input type="hidden" name="id" value={s.plan.id} />{!s.plan.active && <input type="hidden" name="resume" value="1" />}<button className={btnGhost}>{s.plan.active ? "Stop" : "Resume"}</button></form>}
                </div>}>
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
                    <div><div className="text-ink-3">Amount</div><div className="num font-medium">{money(s.currentAmount)}{Number(s.plan.stepUpPct) > 0 && <span className="text-ink-3"> (+{Number(s.plan.stepUpPct)}%/yr)</span>}</div></div>
                    <div><div className="text-ink-3">Next due</div><div className="num font-medium">{s.next ? fmtDate(s.next) : "—"}</div></div>
                    <div><div className="text-ink-3">Since</div><div className="num">{fmtDate(s.plan.startDate)} · day {s.plan.dayOfMonth}</div></div>
                    <div><div className="text-ink-3">Paid / missed</div><div className="num">{s.paid} / <span className={s.missed ? "text-loss" : ""}>{s.missed}</span></div></div>
                    {h && <>
                      <div><div className="text-ink-3">Fund value</div><div className="num font-medium">{money(h.value)}</div></div>
                      <div><div className="text-ink-3">Your XIRR in fund</div><div className={clsx("num font-medium", tone(h.xirr))}>{pct(h.xirr)}</div></div>
                    </>}
                  </div>
                  <div>
                    <div className="mb-1 text-[12px] text-ink-3">Last 12 instalments</div>
                    <div className="flex gap-1" role="list">
                      {last12.map((x) => (
                        <span key={x.due} role="listitem" title={`${fmtDate(x.due)}: ${x.status}${x.matchedDate ? ` (paid ${fmtDate(x.matchedDate)})` : ""}`}
                          className={clsx("h-5 w-3.5 rounded-sm", x.status === "paid" ? "bg-gain" : x.status === "missed" ? "bg-loss" : "border border-line bg-panel-2")} />
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {candidates.length > 0 && <Card title={`Found in your transactions (${candidates.length})`} className="mt-4"><SipSuggestions candidates={candidates} /></Card>}
      <Card title="Add a SIP" className="mt-4">
        {canAdd ? <AddSipForm basePath={config.basePath} today={todayIST()} /> : <Notice kind="info">Switch to a single profile to add a SIP.</Notice>}
      </Card>
    </>
  );
}
