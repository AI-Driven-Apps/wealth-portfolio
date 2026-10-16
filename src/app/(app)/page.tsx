import Link from "next/link";
import { requireCtx } from "@/lib/auth/session";
import { getHoldings, totals, groupBy } from "@/lib/portfolio/holdings";
import { getSips } from "@/lib/portfolio/sips";
import { visibleTypes, TYPE_LABEL } from "@/lib/portfolio/scope";
import { PageHeader, Stat, Card, AllocationBar, Empty, ASSET_COLORS, LinkButton } from "@/components/ui";
import { compact, money, pct, signedMoney, tone, fmtDate } from "@/lib/format";
import { addDays, todayIST } from "@/lib/calc/dates";
import { config } from "@/lib/config";

export const metadata = { title: "Overview" };

export default async function Overview() {
  const ctx = await requireCtx();
  const types = visibleTypes(ctx);
  const all = await getHoldings(ctx.profileIds, types, { includeClosed: true });
  const open = all.filter((h) => h.position.units > 0);
  const t = totals(all);
  const scopeName = ctx.scope === "household" ? "Household" : ctx.profiles.find((p) => p.id === ctx.scope)?.name ?? "";

  if (!ctx.profileIds.length) {
    return <Empty title="No profile assigned yet">Ask the admin to link your login to your profile.</Empty>;
  }
  if (!all.length) {
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
  const today = todayIST();
  const dueSoon = sips.filter((s) => s.next && s.next <= addDays(today, 10));
  const freshness = types.map((ty) => {
    const ds = open.filter((h) => h.instrument.type === ty).map((h) => h.priceDate).filter(Boolean) as string[];
    return { ty, date: ds.sort().at(-1) ?? null };
  }).filter((f) => f.date);

  return (
    <>
      <PageHeader title="Overview" sub={<>{scopeName} · prices as of {freshness.map((f) => `${TYPE_LABEL[f.ty]} ${fmtDate(f.date)}`).join(", ")}</>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Current value" value={compact(t.value)} sub={t.dayChange ? `${signedMoney(t.dayChange)} today` : "—"} subTone={t.dayChange} />
        <Stat label="Invested (held units)" value={compact(t.invested)} sub={`${t.count} holdings`} />
        <Stat label="Unrealised P/L" value={<span className={tone(t.unrealized)}>{signedMoney(t.unrealized)}</span>} sub={pct(t.invested ? t.unrealized / t.invested : null, 1, true)} subTone={t.unrealized} />
        <Stat label="XIRR (all cash flows)" value={<span className={tone(t.xirr)}>{pct(t.xirr)}</span>} sub={`Realised ${signedMoney(t.realized)} · dividends ${money(t.dividends)}`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Where your money is: asset class">
          <AllocationBar parts={groupBy(open, (h) => h.assetClass)} colorFor={(n, i) => ASSET_COLORS[n] ?? `var(--c${(i % 8) + 1})`} />
          <p className="mt-3 text-[12px] text-ink-3">Gold, silver and debt ETFs count toward those classes, not equity. Fund look-through to stocks comes in phase 4.</p>
        </Card>
        <Card title="By product">
          <AllocationBar parts={groupBy(open, (h) => TYPE_LABEL[h.instrument.type])} />
          {dueSoon.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[12px] font-semibold text-ink-2">SIPs due in the next 10 days</div>
              <ul className="space-y-1 text-[13px]">
                {dueSoon.map((s) => (
                  <li key={s.plan.id} className="flex justify-between gap-3"><span className="truncate">{s.instrument.name}</span><span className="num shrink-0 text-ink-2">{fmtDate(s.next)} · {money(s.currentAmount)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card title="Largest holdings" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">{open.length} open</span>}>
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>Holding</th><th>Type</th><th className="r">Value</th><th className="r">Weight</th><th className="r">P/L</th><th className="r">XIRR</th></tr></thead>
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
    </>
  );
}
