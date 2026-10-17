import Link from "next/link";
import clsx from "clsx";
import { requireCtx } from "@/lib/auth/session";
import { getHoldings } from "@/lib/portfolio/holdings";
import { visibleTypes } from "@/lib/portfolio/scope";
import { getLookThrough } from "@/lib/portfolio/lookthrough";
import { effectiveWeights, groupExposures, overlap } from "@/lib/lookthrough/engine";
import { PageHeader, Stat, Card, AllocationBar, Empty, Notice, Badge, ASSET_COLORS, CAP_COLORS, LinkButton } from "@/components/ui";
import { compact, money, pct, fmtMonth, shortFund } from "@/lib/format";

export const metadata = { title: "Look-through" };

const CAP_LABEL: Record<string, string> = { large: "Large cap", mid: "Mid cap", small: "Small cap" };

export default async function LookThroughPage() {
  const ctx = await requireCtx("lookthrough");
  const holdings = await getHoldings(ctx.profileIds, visibleTypes(ctx));
  const funds = holdings.filter((h) => h.instrument.type !== "stock");
  if (!holdings.length) return (<><PageHeader title="Look-through" /><Empty title="No holdings yet">Look-through needs funds or stocks to look into.</Empty></>);

  const { lt, disclosures, instruments } = await getLookThrough(holdings);
  const equity = (lt.classes.get("equity") ?? 0) + (lt.classes.get("international") ?? 0);
  const fundValue = funds.reduce((s, h) => s + h.value, 0);
  const covered = lt.coverage.filter((c) => c.asOf).reduce((s, c) => s + c.value, 0);
  const months = lt.coverage.map((c) => c.asOf).filter(Boolean).sort() as string[];
  const isAdmin = ctx.user.role === "admin";
  // Gold, silver and debt funds are already in the right class without a disclosure.
  const NEEDS = new Set(["equity", "hybrid", "international", "other"]);
  const classOf = new Map(funds.map((h) => [h.instrument.id, h.assetClass]));
  const needs = (fundId: number) => NEEDS.has(classOf.get(fundId) ?? "other");
  const missing = lt.coverage.filter((c) => !c.asOf && needs(c.fundId));

  // Cap mix: Indian stocks by AMFI class, foreign stocks apart, and equity funds we can't see into.
  const caps = groupExposures(lt.exposures.filter((e) => !e.foreign), (e) => (e.capClass ? CAP_LABEL[e.capClass] : null));
  const intl = lt.exposures.filter((e) => e.foreign).reduce((s, e) => s + e.direct + e.viaFunds, 0);
  const capParts = [...caps.map((c) => ({ name: c.name, value: c.value })), ...(intl ? [{ name: "International", value: intl }] : []), ...(lt.equityNotLookedThrough ? [{ name: "Not looked through", value: lt.equityNotLookedThrough }] : [])];
  const capTotal = capParts.reduce((s, p) => s + p.value, 0);

  const sectors = groupExposures(lt.exposures, (e) => (e.foreign ? "International" : e.sector));
  const top = sectors.slice(0, 9);
  const rest = sectors.slice(9).reduce((s, x) => s + x.value, 0);
  const sectorParts = rest ? [...top, { name: "Other sectors", value: rest, pct: 0 }] : top;
  const sectorTotal = sectorParts.reduce((s, p) => s + p.value, 0);

  const classParts = [...lt.classes.entries()].filter(([, v]) => v > 0).map(([name, value]) => ({ name, value, pct: lt.total ? value / lt.total : 0 })).sort((a, b) => b.value - a.value);

  // Overlap between every pair of funds that has a disclosure with stocks in it.
  const ovFunds = funds.filter((h) => disclosures.has(h.instrument.id)).map((h) => ({ h, w: effectiveWeights(h.instrument.id, disclosures) })).filter((f) => f.w.size > 0);
  const nameOf = (id: number) => { const i = instruments.get(id); return i ? (i.type === "mf" ? shortFund(i.name) : i.nseSymbol ?? i.name) : `#${id}`; };

  return (
    <>
      <PageHeader title="Look-through" sub="Your stocks plus the stocks inside your funds and ETFs, from each fund's latest monthly disclosure. Fund-of-funds are followed into their underlying funds." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Equity exposure" value={compact(equity)} sub={`${pct(lt.total ? equity / lt.total : null, 0)} of holdings`} />
        <Stat label="Companies you own" value={lt.exposures.length} sub={`${lt.exposures.filter((e) => e.direct > 0).length} directly`} />
        <Stat label="Fund value looked through" value={pct(fundValue ? covered / fundValue : null, 0)} sub={`${lt.coverage.filter((c) => c.asOf).length} of ${lt.coverage.filter((c) => c.asOf || needs(c.fundId)).length} funds that need one`} />
        <Stat label="Disclosures as of" value={<span className="text-[17px]">{months.length ? (months[0] === months.at(-1) ? fmtMonth(months[0]) : `${fmtMonth(months[0])} – ${fmtMonth(months.at(-1))}`) : "—"}</span>} sub="fund side runs up to ~6 weeks behind" />
      </div>

      {missing.length > 0 && (
        <div className="mt-4"><Notice>{missing.length} fund{missing.length > 1 ? "s have" : " has"} no disclosure yet{lt.equityNotLookedThrough > 0 ? `, so ${compact(lt.equityNotLookedThrough)} of equity shows as "Not looked through"` : ""}.{isAdmin ? <> Upload them under <Link className="font-semibold underline" href="/admin/disclosures">Admin → Disclosures</Link>.</> : " Ask the admin to upload them."}</Notice></div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Equity by market cap (look-through)">
          <AllocationBar parts={capParts.map((p) => ({ ...p, pct: capTotal ? p.value / capTotal : 0 }))} colorFor={(n) => CAP_COLORS[n.split(" ")[0].toLowerCase()] ?? (n === "International" ? "var(--c6)" : "var(--c8)")} />
          <p className="mt-3 text-[12px] text-ink-3">AMFI's half-yearly list: top 100 companies by market cap are large, 101–250 mid, the rest small. Stocks not on the list are unclassified.</p>
        </Card>
        <Card title="Asset classes (look-through)">
          <AllocationBar parts={classParts} colorFor={(n, i) => ASSET_COLORS[n] ?? `var(--c${(i % 8) + 1})`} />
          <p className="mt-3 text-[12px] text-ink-3">Hybrid and multi-asset funds split into what they actually hold. "Not itemised" is the part of a disclosure that wasn't listed line by line.</p>
        </Card>
      </div>

      <Card title="Equity by sector (look-through)" className="mt-4">
        <AllocationBar parts={sectorParts.map((p) => ({ ...p, pct: sectorTotal ? p.value / sectorTotal : 0 }))} />
      </Card>

      <Card title="Largest companies you own" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">{lt.exposures.length > 25 ? `top 25 of ${lt.exposures.length}` : `${lt.exposures.length} companies`}</span>}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>Company</th><th>Cap</th><th>Sector</th><th className="r">Direct</th><th className="r">Through funds</th><th className="r">Total</th><th className="r">Of equity</th><th>Through</th></tr></thead>
          <tbody>{lt.exposures.slice(0, 25).map((e) => {
            const total = e.direct + e.viaFunds;
            const via = [...e.via.entries()].sort((a, b) => b[1] - a[1]);
            return (
              <tr key={e.key} className="hover:bg-panel-2">
                <td className="max-w-[260px]">{e.instrumentId && e.direct > 0 ? <Link href={`/holding/${e.instrumentId}`} className="block truncate font-medium hover:underline">{e.name}</Link> : <span className="block truncate font-medium">{e.name}</span>}</td>
                <td>{e.foreign ? <Badge>intl</Badge> : e.capClass ? <Badge>{e.capClass}</Badge> : <span className="text-ink-3">—</span>}</td>
                <td className="max-w-[160px] truncate text-ink-2">{e.sector ?? "—"}</td>
                <td className="r num">{e.direct ? money(e.direct) : "—"}</td>
                <td className="r num">{e.viaFunds ? money(e.viaFunds) : "—"}</td>
                <td className="r num font-medium">{money(total)}</td>
                <td className="r num">{pct(equity ? total / equity : null)}</td>
                <td className="max-w-[260px] truncate text-[12px] text-ink-3" title={via.map(([id, v]) => `${nameOf(id)}: ${money(v)}`).join("\n")}>{via.slice(0, 2).map(([id]) => nameOf(id)).join(", ")}{via.length > 2 ? ` +${via.length - 2}` : ""}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>

      <Card title="Fund overlap" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">share of one fund you already own through the other</span>}>
        {ovFunds.length < 2 ? <p className="px-4 py-5 text-ink-3">Needs disclosures for at least two of your equity funds or ETFs.</p> : (
          <div className="overflow-x-auto"><table>
            <thead><tr><th />{ovFunds.map((f) => <th key={f.h.instrument.id} className="max-w-[120px] truncate text-center" title={f.h.instrument.name}>{nameOf(f.h.instrument.id)}</th>)}</tr></thead>
            <tbody>{ovFunds.map((a) => (
              <tr key={a.h.instrument.id}>
                <td className="max-w-[220px] truncate font-medium" title={a.h.instrument.name}>{nameOf(a.h.instrument.id)}</td>
                {ovFunds.map((b) => {
                  if (a === b) return <td key={b.h.instrument.id} className="text-center text-ink-3">—</td>;
                  const o = overlap(a.w, b.w);
                  // Cell shading scales with overlap; the number is always printed.
                  return (
                    <td key={b.h.instrument.id} className={clsx("num text-center", o.pct >= 40 && "font-semibold")} title={`${o.common} stocks in common`}
                      style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(Math.min(o.pct, 100) * 0.3)}%, transparent)` }}>
                      {o.pct.toFixed(0)}%<div className="text-[11px] font-normal text-ink-2">{o.common} common</div>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <Card title="Disclosures used" className="mt-4" pad={false} actions={isAdmin ? <LinkButton href="/admin/disclosures">Upload</LinkButton> : undefined}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>Fund / ETF</th><th className="r">Your value</th><th>Disclosure</th><th className="r">Itemised</th><th>Underlying funds not looked through</th></tr></thead>
          <tbody>{lt.coverage.sort((a, b) => b.value - a.value).map((c) => (
            <tr key={c.fundId}>
              <td className="max-w-[320px]"><Link href={`/holding/${c.fundId}`} className="block truncate hover:underline">{instruments.get(c.fundId)?.name ?? c.fundId}</Link></td>
              <td className="r num">{money(c.value)}</td>
              <td>{c.asOf ? fmtMonth(c.asOf) : needs(c.fundId) ? <Badge kind="warn">none yet</Badge> : <span className="text-[12px] text-ink-3">not needed ({classOf.get(c.fundId)})</span>}</td>
              <td className="r num">{c.asOf ? pct(c.itemised, 0) : "—"}</td>
              <td className="max-w-[260px] truncate text-[12px] text-ink-3">{c.unresolvedFunds.join(", ") || "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  );
}
