import { requireCtx } from "@/lib/auth/session";
import { getHoldings, totals, groupBy, trailingReturns } from "@/lib/portfolio/holdings";
import { HoldingsTable, ClosedPositions } from "@/components/holdings-table";
import { PageHeader, Stat, Card, AllocationBar, Empty, ASSET_COLORS, Notice, LinkButton } from "@/components/ui";
import { compact, pct, signedMoney, tone, money } from "@/lib/format";
import { config } from "@/lib/config";

export const metadata = { title: "Mutual funds" };

const shortCat = (c: string | null) => (c ?? "Uncategorised").replace(/^(Equity|Debt|Hybrid|Other|Solution Oriented) Scheme - /, "");

export default async function MfPage() {
  const ctx = await requireCtx("mf");
  const all = await getHoldings(ctx.profileIds, ["mf"], { includeClosed: true });
  const open = all.filter((h) => h.position.units > 0);
  const t = totals(all);
  const tr = await trailingReturns(open.map((h) => h.instrument.id));
  const regular = open.filter((h) => h.instrument.plan === "regular");

  if (!all.length) return (<><PageHeader title="Mutual funds" /><Empty title="No mutual funds yet">Import a detailed CAMS or KFintech statement to load every folio with full transaction history.{config.importsEnabled && <div className="mt-4"><LinkButton href="/import" primary>Import CAS</LinkButton></div>}</Empty></>);

  return (
    <>
      <PageHeader title="Mutual funds" sub="Your return (XIRR) beside each fund's own 1/3-year return: the gap shows whether your timing helped." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Current value" value={compact(t.value)} sub={t.dayChange ? `${signedMoney(t.dayChange)} on latest NAV` : undefined} subTone={t.dayChange} />
        <Stat label="Invested" value={compact(t.invested)} sub={`${t.count} funds`} />
        <Stat label="Unrealised P/L" value={<span className={tone(t.unrealized)}>{signedMoney(t.unrealized)}</span>} sub={pct(t.invested ? t.unrealized / t.invested : null, 1, true)} subTone={t.unrealized} />
        <Stat label="XIRR" value={<span className={tone(t.xirr)}>{pct(t.xirr)}</span>} sub={`Realised ${signedMoney(t.realized)}`} />
      </div>
      {regular.length > 0 && (
        <div className="mt-4"><Notice>{regular.length} holding{regular.length > 1 ? "s are" : " is"} in a Regular plan ({money(regular.reduce((s, h) => s + h.value, 0))}). Direct plans of the same fund usually cost 0.5–1.5% a year less.</Notice></div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="By asset class"><AllocationBar parts={groupBy(open, (h) => h.assetClass)} colorFor={(n, i) => ASSET_COLORS[n] ?? `var(--c${(i % 8) + 1})`} /></Card>
        <Card title="By SEBI category"><AllocationBar parts={groupBy(open, (h) => shortCat(h.instrument.schemeCategory))} /></Card>
      </div>
      <Card title="Holdings" className="mt-4" pad={false}>
        <HoldingsTable holdings={open} totals={t} priceLabel="NAV" extra={[
          { header: "Fund 1Y", right: true, title: "The fund's own NAV return over 1 year", cell: (h) => <span className={tone(tr.get(h.instrument.id)?.r1)}>{pct(tr.get(h.instrument.id)?.r1)}</span> },
          { header: "Fund 3Y", right: true, title: "The fund's own NAV CAGR over 3 years", cell: (h) => <span className={tone(tr.get(h.instrument.id)?.r3)}>{pct(tr.get(h.instrument.id)?.r3)}</span> },
        ]} />
      </Card>
      <ClosedPositions holdings={all} />
    </>
  );
}
