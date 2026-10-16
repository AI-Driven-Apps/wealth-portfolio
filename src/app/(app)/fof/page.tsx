import { requireCtx } from "@/lib/auth/session";
import { getHoldings, totals } from "@/lib/portfolio/holdings";
import { HoldingsTable } from "@/components/holdings-table";
import { PageHeader, Card, Empty, Notice } from "@/components/ui";

export const metadata = { title: "Fund of funds" };

export default async function FofPage() {
  const ctx = await requireCtx("fof");
  const all = (await getHoldings(ctx.profileIds, ["mf"], { includeClosed: true })).filter((h) => h.instrument.isFof);
  const open = all.filter((h) => h.position.units > 0);
  return (
    <>
      <PageHeader title="Fund of funds" sub="Funds that invest in other funds. Tracked like any mutual fund; the underlying funds get their own breakdown in phase 4." />
      {!open.length ? <Empty title="No fund-of-funds holdings">FoF schemes are recognised automatically from AMFI's category when you import a statement.</Empty> : (
        <>
          <Notice kind="info">Look-through to the underlying funds and their stocks (two levels deep) arrives with phase 4. Until then each FoF counts toward its own asset class.</Notice>
          <Card title="Holdings" className="mt-4" pad={false}><HoldingsTable holdings={open} totals={totals(all)} priceLabel="NAV" extra={[{ header: "Exposure", cell: (h) => <span className="capitalize">{h.assetClass}</span> }]} /></Card>
        </>
      )}
    </>
  );
}
