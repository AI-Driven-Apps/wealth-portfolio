import { requireCtx } from "@/lib/auth/session";
import { getHoldings, totals, groupBy } from "@/lib/portfolio/holdings";
import { HoldingsTable, ClosedPositions } from "@/components/holdings-table";
import { PageHeader, Stat, Card, AllocationBar, Empty, CAP_COLORS, Badge, LinkButton } from "@/components/ui";
import { compact, pct, signedMoney, tone, money } from "@/lib/format";
import { config } from "@/lib/config";

export const metadata = { title: "Stocks" };

const CAP_LABEL: Record<string, string> = { large: "Large cap", mid: "Mid cap", small: "Small cap" };

export default async function EquityPage() {
  const ctx = await requireCtx("equity");
  const all = await getHoldings(ctx.profileIds, ["stock"], { includeClosed: true });
  const open = all.filter((h) => h.position.units > 0);
  const t = totals(all);
  if (!all.length) return (<><PageHeader title="Stocks" /><Empty title="No stocks yet">Import your broker tradebook (XLS/CSV) or contract notes (PDF).{config.importsEnabled && <div className="mt-4"><LinkButton href="/import" primary>Import trades</LinkButton></div>}</Empty></>);
  const unclassified = open.filter((h) => !h.instrument.capClass).length;

  return (
    <>
      <PageHeader title="Stocks" sub="Direct equity. Cap class follows AMFI's half-yearly list (top 100 large, 101–250 mid, rest small)." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Current value" value={compact(t.value)} sub={t.dayChange ? `${signedMoney(t.dayChange)} today` : undefined} subTone={t.dayChange} />
        <Stat label="Invested" value={compact(t.invested)} sub={`${t.count} stocks`} />
        <Stat label="Unrealised P/L" value={<span className={tone(t.unrealized)}>{signedMoney(t.unrealized)}</span>} sub={pct(t.invested ? t.unrealized / t.invested : null, 1, true)} subTone={t.unrealized} />
        <Stat label="XIRR" value={<span className={tone(t.xirr)}>{pct(t.xirr)}</span>} sub={`Realised ${signedMoney(t.realized)} · dividends ${money(t.dividends)}`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="By sector"><AllocationBar parts={groupBy(open, (h) => h.instrument.sector)} /></Card>
        <Card title="By market cap">
          <AllocationBar parts={groupBy(open, (h) => h.instrument.capClass ? CAP_LABEL[h.instrument.capClass] : null).map((p) => p)} colorFor={(n) => CAP_COLORS[n.split(" ")[0].toLowerCase()] ?? "var(--c8)"} />
          {unclassified > 0 && ctx.user.role === "admin" && <p className="mt-3 text-[12px] text-ink-3">{unclassified} stock{unclassified > 1 ? "s have" : " has"} no cap class. Upload AMFI's market-cap list under Admin → Data sources.</p>}
        </Card>
      </div>
      <Card title="Holdings" className="mt-4" pad={false}>
        <HoldingsTable holdings={open} totals={t} extra={[
          { header: "Sector", cell: (h) => <span className="text-ink-2">{h.instrument.sector ?? "—"}</span> },
          { header: "Cap", cell: (h) => h.instrument.capClass ? <Badge>{h.instrument.capClass}</Badge> : <span className="text-ink-3">—</span> },
          { header: "Today", right: true, cell: (h) => <span className={tone(h.dayChange)}>{h.dayChange == null ? "—" : signedMoney(h.dayChange)}</span> },
        ]} />
      </Card>
      <ClosedPositions holdings={all} />
    </>
  );
}
