import Link from "next/link";
import { inArray } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { getHoldings, totals } from "@/lib/portfolio/holdings";
import { loadDisclosures } from "@/lib/portfolio/lookthrough";
import { HoldingsTable } from "@/components/holdings-table";
import { PageHeader, Card, Empty, Notice, Badge } from "@/components/ui";
import { fmtMonth, money, pct } from "@/lib/format";

export const metadata = { title: "Fund of funds" };

export default async function FofPage() {
  const ctx = await requireCtx("fof");
  const all = (await getHoldings(ctx.profileIds, ["mf"], { includeClosed: true })).filter((h) => h.instrument.isFof);
  const open = all.filter((h) => h.position.units > 0);
  const lookthrough = ctx.features.has("lookthrough");
  const disclosures = lookthrough && open.length ? await loadDisclosures(open.map((h) => h.instrument.id)) : new Map();
  const childIds = [...disclosures.values()].flatMap((d) => d.lines.map((l: { holdingInstrumentId: number | null }) => l.holdingInstrumentId)).filter((x): x is number => x != null);
  const children = childIds.length ? new Map((await db.select().from(schema.instrument).where(inArray(schema.instrument.id, childIds))).map((i) => [i.id, i])) : new Map();

  return (
    <>
      <PageHeader title="Fund of funds" sub="Funds that invest in other funds. Tracked like any mutual fund; look-through follows them into the underlying schemes." />
      {!open.length ? <Empty title="No fund-of-funds holdings">FoF schemes are recognised automatically from AMFI's category when you import a statement.</Empty> : (
        <>
          <Card title="Holdings" pad={false}><HoldingsTable holdings={open} totals={totals(all)} priceLabel="NAV" extra={[{ header: "Exposure", cell: (h) => <span className="capitalize">{h.assetClass}</span> }]} /></Card>
          {!lookthrough ? <div className="mt-4"><Notice kind="info">Underlying funds show here when the look-through module is on.</Notice></div> : open.map((h) => {
            const d = disclosures.get(h.instrument.id);
            return (
              <Card key={h.instrument.id} className="mt-4" pad={false} title={<Link href={`/holding/${h.instrument.id}`} className="hover:underline">{h.instrument.name}</Link>}
                actions={<span className="text-[12px] text-ink-3">{d ? `disclosure ${fmtMonth(d.asOf)}` : "no disclosure yet"}</span>}>
                {!d ? <p className="px-4 py-4 text-[13px] text-ink-3">Upload this FoF's monthly portfolio{ctx.user.role === "admin" ? <> under <Link href="/admin/disclosures" className="underline">Admin → Disclosures</Link></> : " (admin)"} to see its underlying funds.</p> : (
                  <div className="overflow-x-auto"><table>
                    <thead><tr><th>Underlying</th><th className="r">Weight</th><th className="r">Your share</th><th>Its own breakdown</th></tr></thead>
                    <tbody>{[...d.lines].sort((a, b) => b.weightPct - a.weightPct).map((l, i) => {
                      const child = l.holdingInstrumentId != null ? children.get(l.holdingInstrumentId) : undefined;
                      return (
                        <tr key={i}>
                          <td className="max-w-[380px] truncate">{l.name}{l.kind !== "fund" && <span className="ml-1.5"><Badge>{l.kind.replace("_", " ")}</Badge></span>}</td>
                          <td className="r num">{pct(l.weightPct / 100)}</td>
                          <td className="r num">{money((h.value * l.weightPct) / 100)}</td>
                          <td className="text-[12px] text-ink-2">{l.kind !== "fund" ? "—" : !child ? <Badge kind="warn">scheme not matched</Badge> : disclosures.has(child.id) ? `looked through (${fmtMonth(disclosures.get(child.id)!.asOf)})` : <span className="text-ink-3">no disclosure: counted as {child.underlyingClass ?? "other"}</span>}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table></div>
                )}
              </Card>
            );
          })}
        </>
      )}
    </>
  );
}
