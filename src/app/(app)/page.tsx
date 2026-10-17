import Link from "next/link";
import { requireCtx } from "@/lib/auth/session";
import { groupBy } from "@/lib/portfolio/holdings";
import { getSips } from "@/lib/portfolio/sips";
import { consolidated, netWorthTrend } from "@/lib/portfolio/consolidated";
import { getTargets } from "@/lib/portfolio/allocation";
import { computeDrift } from "@/lib/calc/drift";
import { getSetting } from "@/lib/settings";
import { visibleTypes, TYPE_LABEL } from "@/lib/portfolio/scope";
import { NetWorthChart } from "@/components/charts";
import { PageHeader, Stat, Card, AllocationBar, Empty, ASSET_COLORS, LinkButton, Notice, classLabel } from "@/components/ui";
import { compact, money, pct, signedMoney, tone, fmtDate } from "@/lib/format";
import { addDays, todayIST } from "@/lib/calc/dates";
import { config } from "@/lib/config";

export const metadata = { title: "Overview" };

export default async function Overview() {
  const ctx = await requireCtx();
  if (!ctx.profileIds.length) {
    return <Empty title="No profile assigned yet">Ask the admin to link your login to your profile.</Empty>;
  }
  const today = todayIST();
  const types = visibleTypes(ctx);
  const c = await consolidated(ctx, today);
  const all = c.market;
  const open = all.filter((h) => h.position.units > 0);
  const t = c.marketTotals;
  const scopeName = ctx.scope === "household" ? "Household" : ctx.profiles.find((p) => p.id === ctx.scope)?.name ?? "";

  if (!all.length && !c.fixed.length && !c.loans.length) {
    return (
      <>
        <PageHeader title="Overview" sub={scopeName} />
        <Empty title="No holdings yet">
          {config.importsEnabled && ctx.features.has("imports")
            ? <>Start by importing your CAMS/KFintech statement (mutual funds) or your broker tradebook (stocks and ETFs).<div className="mt-4"><LinkButton href="/import" primary>Import statements</LinkButton></div></>
            : <>Add transactions from the Transactions page.</>}
        </Empty>
      </>
    );
  }

  const sips = ctx.features.has("sip") ? await getSips(ctx.profileIds) : [];
  const trend = await netWorthTrend(ctx, c, 60, today);
  const trendKeys = [...new Set(trend.flatMap((p) => Object.keys(p.byClass)))].sort((a, b) => (c.classes.get(b) ?? 0) - (c.classes.get(a) ?? 0));
  const chartData = trend.map((p) => ({ date: p.date, net: p.net, liabilities: p.liabilities, ...Object.fromEntries(trendKeys.map((k) => [k, p.byClass[k] ?? 0])) }));

  // Drift: shown for a single profile with targets.
  let breached: string[] = [];
  if (ctx.features.has("drift") && ctx.scope !== "household") {
    const targets = await getTargets(ctx.scope);
    if (targets.length) breached = computeDrift(c.classes, targets, await getSetting("drift_default_band")).filter((r) => r.breached).map((r) => `${classLabel(r.assetClass)} ${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)} pts`);
  }

  const upcoming = [
    ...sips.filter((s) => s.next && s.next <= addDays(today, 10)).map((s) => ({ date: s.next!, what: `SIP · ${s.instrument.name}`, amount: s.currentAmount })),
    ...c.fixed.filter((f) => !f.asset.closedOn && f.asset.maturityDate && f.asset.maturityDate >= today && f.asset.maturityDate <= addDays(today, 30)).map((f) => ({ date: f.asset.maturityDate!, what: `Matures · ${f.asset.name}`, amount: f.maturity ?? 0 })),
    ...c.loans.filter((l) => l.status.nextEmiDate && l.status.nextEmiDate <= addDays(today, 10)).map((l) => ({ date: l.status.nextEmiDate!, what: `EMI · ${l.loan.name}`, amount: l.status.currentEmi })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const freshness = types.map((ty) => {
    const ds = open.filter((h) => h.instrument.type === ty).map((h) => h.priceDate).filter(Boolean) as string[];
    return { ty, date: ds.sort().at(-1) ?? null };
  }).filter((f) => f.date);
  const fixedValue = c.fixed.reduce((s, f) => s + f.now.value, 0);
  const classParts = [...c.classes.entries()].map(([name, value]) => ({ name, value, pct: c.assets ? value / c.assets : 0 })).sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHeader title="Overview" sub={<>{scopeName}{freshness.length > 0 && <> · prices as of {freshness.map((f) => `${TYPE_LABEL[f.ty]} ${fmtDate(f.date)}`).join(", ")}</>}</>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net worth" value={compact(c.net)} sub={c.liabilities ? `assets ${compact(c.assets)} − loans ${compact(c.liabilities)}` : `${compact(c.assets)} in assets`} />
        <Stat label="Market holdings" value={compact(t.value)} sub={t.dayChange ? `${signedMoney(t.dayChange)} today` : `${t.count} holdings`} subTone={t.dayChange || undefined} />
        <Stat label="Unrealised P/L" value={<span className={tone(t.unrealized)}>{signedMoney(t.unrealized)}</span>} sub={`${pct(t.invested ? t.unrealized / t.invested : null, 1, true)} on ${compact(t.invested)} invested`} subTone={t.unrealized} />
        <Stat label="XIRR (market holdings)" value={<span className={tone(t.xirr)}>{pct(t.xirr)}</span>} sub={`Realised ${signedMoney(t.realized)} · dividends ${money(t.dividends)}`} />
      </div>
      {breached.length > 0 && <div className="mt-4"><Notice>Allocation is outside its band: {breached.join(", ")}. <Link href="/allocation" className="font-semibold underline">See targets</Link></Notice></div>}

      <Card title="Net worth, month by month" className="mt-4">
        <NetWorthChart data={chartData} keys={trendKeys} colors={Object.fromEntries(trendKeys.map((k, i) => [k, ASSET_COLORS[k] ?? `var(--c${(i % 8) + 1})`]))} labels={Object.fromEntries(trendKeys.map((k) => [k, classLabel(k)]))} />
        <p className="mt-2 text-[12px] text-ink-3">Past months use the units you held then at month-end prices; fixed assets are accrued, loans amortised to that date.</p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Where your money is: asset class" actions={ctx.features.has("lookthrough") ? <Link href="/lookthrough" className="text-[12px] text-accent hover:underline">Look through funds →</Link> : undefined}>
          <AllocationBar parts={classParts} colorFor={(n, i) => ASSET_COLORS[n] ?? `var(--c${(i % 8) + 1})`} />
          <p className="mt-3 text-[12px] text-ink-3">Gold, silver and debt ETFs count toward those classes, not equity.{fixedValue > 0 && " Deposits, PPF/EPF and other fixed holdings are included."}</p>
        </Card>
        <Card title="By product">
          <AllocationBar parts={[
            ...groupBy(open, (h) => TYPE_LABEL[h.instrument.type]).map((p) => ({ name: p.name, value: p.value })),
            ...(fixedValue > 0 ? [{ name: "Fixed & alts", value: fixedValue }] : []),
          ].map((p) => ({ ...p, pct: c.assets ? p.value / c.assets : 0 })).sort((a, b) => b.value - a.value)} />
          {upcoming.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[12px] font-semibold text-ink-2">Coming up</div>
              <ul className="space-y-1 text-[13px]">
                {upcoming.slice(0, 8).map((u, i) => (
                  <li key={i} className="flex justify-between gap-3"><span className="truncate">{u.what}</span><span className="num shrink-0 text-ink-2">{fmtDate(u.date)} · {money(u.amount)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {open.length > 0 && (
        <Card title="Largest holdings" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">{open.length} open</span>}>
          <div className="overflow-x-auto">
            <table>
              <thead><tr><th>Holding</th><th>Type</th><th className="r">Value</th><th className="r" title="Share of market holdings">Weight</th><th className="r">P/L</th><th className="r">XIRR</th></tr></thead>
              <tbody>
                {open.slice(0, 10).map((h) => (
                  <tr key={h.instrument.id} className="hover:bg-panel-2">
                    <td className="max-w-[360px]"><Link className="block truncate hover:underline" href={`/holding/${h.instrument.id}`}>{h.instrument.type === "mf" ? h.instrument.name : `${h.instrument.nseSymbol} · ${h.instrument.name}`}</Link></td>
                    <td className="text-ink-2">{TYPE_LABEL[h.instrument.type]}</td>
                    <td className="r num">{money(h.value)}</td>
                    <td className="r num">{pct(t.value ? h.value / t.value : null)}</td>
                    <td className={`r num ${tone(h.unrealized)}`}>{pct(h.unrealizedPct, 1, true)}</td>
                    <td className={`r num ${tone(h.xirr)}`}>{pct(h.xirr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
