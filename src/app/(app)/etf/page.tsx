import { inArray } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { getHoldings, totals, groupBy, trailingReturns } from "@/lib/portfolio/holdings";
import { HoldingsTable, ClosedPositions } from "@/components/holdings-table";
import { PageHeader, Stat, Card, AllocationBar, Empty, ASSET_COLORS, LinkButton } from "@/components/ui";
import { compact, pct, signedMoney, tone, fmtDate } from "@/lib/format";
import { config } from "@/lib/config";

export const metadata = { title: "ETFs" };

export default async function EtfPage() {
  const ctx = await requireCtx("etf");
  const all = await getHoldings(ctx.profileIds, ["etf"], { includeClosed: true });
  const open = all.filter((h) => h.position.units > 0);
  const t = totals(all);
  if (!all.length) return (<><PageHeader title="ETFs" /><Empty title="No ETFs yet">ETFs come in with your stock trades: import your tradebook or contract notes.{config.importsEnabled && <div className="mt-4"><LinkButton href="/import" primary>Import trades</LinkButton></div>}</Empty></>);

  // Tracking difference: ETF 1-year return minus its index's 1-year return.
  const benchSyms = [...new Set(open.map((h) => h.instrument.benchmarkYahoo).filter(Boolean))] as string[];
  const benches = benchSyms.length ? await db.select().from(schema.instrument).where(inArray(schema.instrument.yahooSymbol, benchSyms)) : [];
  const tr = await trailingReturns([...open.map((h) => h.instrument.id), ...benches.map((b) => b.id)]);
  const benchR1 = (sym: string | null) => { const b = benches.find((x) => x.yahooSymbol === sym); return b ? tr.get(b.id)?.r1 ?? null : null; };

  return (
    <>
      <PageHeader title="ETFs" sub="Exchange-traded funds, grouped by what they hold. A gold or debt ETF counts as gold or debt in your allocation, not equity." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Current value" value={compact(t.value)} sub={t.dayChange ? `${signedMoney(t.dayChange)} today` : undefined} subTone={t.dayChange} />
        <Stat label="Invested" value={compact(t.invested)} sub={`${t.count} ETFs`} />
        <Stat label="Unrealised P/L" value={<span className={tone(t.unrealized)}>{signedMoney(t.unrealized)}</span>} sub={pct(t.invested ? t.unrealized / t.invested : null, 1, true)} subTone={t.unrealized} />
        <Stat label="XIRR" value={<span className={tone(t.xirr)}>{pct(t.xirr)}</span>} sub={`Realised ${signedMoney(t.realized)}`} />
      </div>
      <Card title="By underlying" className="mt-4"><AllocationBar parts={groupBy(open, (h) => h.assetClass)} colorFor={(n, i) => ASSET_COLORS[n] ?? `var(--c${(i % 8) + 1})`} /></Card>
      <Card title="Holdings" className="mt-4" pad={false}>
        <HoldingsTable holdings={open} totals={t} extra={[
          { header: "Holds", cell: (h) => <span className="capitalize text-ink-2">{h.assetClass}{h.instrument.trackedIndex ? <span className="block text-[11px] normal-case text-ink-3">{h.instrument.trackedIndex}</span> : null}</span> },
          {
            header: "vs NAV", right: true, title: "Market price vs the latest published NAV. Positive = you pay a premium.",
            cell: (h) => {
              const nav = h.instrument.lastNav ? Number(h.instrument.lastNav) : null;
              if (!nav || !h.price) return <span className="text-ink-3">—</span>;
              const d = h.price / nav - 1;
              return <span title={`NAV ${nav} on ${fmtDate(h.instrument.lastNavDate)}`} className={Math.abs(d) > 0.005 ? "text-warn" : "text-ink-2"}>{pct(d, 2, true)}</span>;
            },
          },
          {
            header: "Tracking 1Y", right: true, title: "ETF 1-year return minus its index's 1-year return. Uses the price index, so dividends make ETFs look slightly better than they are.",
            cell: (h) => {
              const e = tr.get(h.instrument.id)?.r1, b = benchR1(h.instrument.benchmarkYahoo);
              return e == null || b == null ? <span className="text-ink-3">—</span> : <span className={tone(e - b)}>{pct(e - b, 2, true)}</span>;
            },
          },
        ]} />
      </Card>
      <p className="mt-3 text-[12px] text-ink-3">Live iNAV isn't published in a free feed, so "vs NAV" compares with the latest end-of-day NAV from AMFI.</p>
      <ClosedPositions holdings={all} />
    </>
  );
}
