import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { getHoldings, priceSeries, txnsFor, trailingReturns, totals } from "@/lib/portfolio/holdings";
import { range52w } from "@/lib/calc/returns";
import { PriceChart, type Marker } from "@/components/charts";
import { PageHeader, Card, Stat, Badge, Empty, btnDanger } from "@/components/ui";
import { money, pct, fmtPrice, fmtUnits, fmtDate, tone, signedMoney } from "@/lib/format";
import { deleteTxn } from "../../transactions/actions";

const FEATURE = { mf: "mf", stock: "equity", etf: "etf", index: "etf" } as const;
const TXN_LABEL: Record<string, string> = { buy: "Buy", sell: "Sell", sip: "SIP", switch_in: "Switch in", switch_out: "Switch out", dividend_payout: "Dividend", dividend_reinvest: "Dividend reinvested", bonus: "Bonus", split: "Split" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return { title: "Holding" };
  const [ins] = await db.select({ name: schema.instrument.name, sym: schema.instrument.nseSymbol, type: schema.instrument.type }).from(schema.instrument).where(eq(schema.instrument.id, id));
  return { title: ins ? (ins.type === "mf" ? ins.name : ins.sym ?? ins.name) : "Holding" };
}

export default async function HoldingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const insId = Number(id);
  if (!Number.isInteger(insId)) notFound();
  const [ins] = await db.select().from(schema.instrument).where(eq(schema.instrument.id, insId));
  if (!ins || ins.type === "index") notFound();
  const ctx = await requireCtx(FEATURE[ins.type]);

  const [h] = await getHoldings(ctx.profileIds, [ins.type], { includeClosed: true, instrumentId: insId });
  const series = await priceSeries(insId);
  const txns = await txnsFor(ctx.profileIds, insId);
  let bench: { name: string; series: { date: string; close: number }[] } | null = null;
  if (ins.benchmarkYahoo) {
    const [b] = await db.select().from(schema.instrument).where(eq(schema.instrument.yahooSymbol, ins.benchmarkYahoo));
    if (b) bench = { name: b.name, series: (await priceSeries(b.id)).map((p) => ({ date: p.date, close: p.adj })) };
  }
  const tr = (await trailingReturns([insId])).get(insId);
  const r52 = range52w(series);

  // Snap each trade to the nearest trading day on or before it so markers sit on the line.
  const dates = series.map((p) => p.date);
  const snap = (d: string) => { let lo = 0, hi = dates.length - 1, a = dates[0]; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { a = dates[m]; lo = m + 1; } else hi = m - 1; } return a; };
  const markers: Marker[] = series.length ? txns.filter(({ t }) => ["buy", "sip", "sell", "switch_in", "switch_out"].includes(t.type)).map(({ t }) => ({
    date: snap(t.date), kind: ["sell", "switch_out"].includes(t.type) ? "sell" : "buy", units: Number(t.units), price: Number(t.price),
  })) : [];

  const priceLabel = ins.type === "mf" ? "NAV" : "Price";
  const pos = h?.position;
  const t = h ? totals([h]) : null;
  const canEdit = ctx.canManage && ctx.scope !== "household";

  return (
    <>
      <PageHeader
        title={ins.type === "mf" ? ins.name : `${ins.nseSymbol ?? ""} · ${ins.name}`}
        sub={<span className="flex flex-wrap items-center gap-1.5">
          {ins.amc && <span>{ins.amc}</span>}
          {ins.schemeCategory && <Badge>{ins.schemeCategory.replace(/^.* Scheme - /, "")}</Badge>}
          {ins.plan && <Badge kind={ins.plan === "regular" ? "warn" : "accent"}>{ins.plan}</Badge>}
          {ins.isFof && <Badge>Fund of funds</Badge>}
          {ins.sector && <Badge>{ins.sector}</Badge>}
          {ins.capClass && <Badge>{ins.capClass} cap</Badge>}
          {ins.trackedIndex && <Badge>Tracks {ins.trackedIndex}</Badge>}
          {ins.isin && <span className="num text-[12px] text-ink-3">{ins.isin}</span>}
          {ins.amfiCode && <span className="num text-[12px] text-ink-3">AMFI {ins.amfiCode}</span>}
        </span>}
      />
      {!h ? <Empty title="Not held in this profile">Switch profile or add a transaction.</Empty> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Current value" value={money(h.value)} sub={`${fmtUnits(pos!.units)} units @ ${fmtPrice(h.price)}`} />
          <Stat label="Unrealised P/L" value={<span className={tone(h.unrealized)}>{signedMoney(h.unrealized)}</span>} sub={`Invested ${money(pos!.invested)} · avg ${fmtPrice(pos!.avgCost)}`} />
          <Stat label="Your XIRR" value={<span className={tone(h.xirr)}>{pct(h.xirr)}</span>} sub={`Realised ${signedMoney(pos!.realized)}${pos!.dividends ? ` · dividends ${money(pos!.dividends)}` : ""}`} />
          <Stat label={`${ins.type === "mf" ? "Fund" : "Stock"} return 1Y / 3Y / 5Y`} value={<span className="text-[17px]"><span className={tone(tr?.r1)}>{pct(tr?.r1)}</span> / <span className={tone(tr?.r3)}>{pct(tr?.r3)}</span> / <span className={tone(tr?.r5)}>{pct(tr?.r5)}</span></span>} sub={r52 ? `52-week ${fmtPrice(r52.low)} – ${fmtPrice(r52.high)} (${pct(r52.position, 0)} of range)` : undefined} />
        </div>
      )}
      {pos && pos.warnings.length > 0 && <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{pos.warnings.map((w) => <div key={w}>{w}</div>)}</div>}

      <Card title={`${priceLabel} history`} className="mt-4">
        {/* Stocks/ETFs chart on adjusted prices so a split or bonus doesn't look like a crash;
            FIFO average cost is in post-split terms too, so the two line up. */}
        <PriceChart series={series.map((p) => ({ date: p.date, close: ins.type === "mf" ? p.close : p.adj }))} markers={markers} avgCost={pos && pos.units > 0 ? pos.avgCost : null} label={ins.type === "mf" ? "NAV" : "Price (split-adjusted)"} benchmark={bench} />
      </Card>

      {pos && pos.lots.length > 0 && (
        <Card title="Open lots (FIFO)" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">Oldest lots are sold first, as Indian capital-gains rules require</span>}>
          <div className="overflow-x-auto"><table>
            <thead><tr><th>Bought</th><th className="r">Units</th><th className="r">Cost / unit</th><th className="r">Cost</th><th className="r">Value now</th><th className="r">Gain</th><th>Held</th></tr></thead>
            <tbody>{pos.lots.map((l, i) => {
              const v = h!.price != null ? l.units * h!.price : null; const days = Math.round((Date.now() - Date.parse(l.date)) / 86_400_000);
              return (<tr key={i}><td>{fmtDate(l.date)}</td><td className="r num">{fmtUnits(l.units)}</td><td className="r num">{fmtPrice(l.costPerUnit)}</td><td className="r num">{money(l.units * l.costPerUnit)}</td><td className="r num">{money(v)}</td><td className={`r num ${tone(v == null ? null : v - l.units * l.costPerUnit)}`}>{v == null ? "—" : signedMoney(v - l.units * l.costPerUnit)}</td><td className="text-ink-2">{days >= 365 ? <Badge kind="accent">over 1 year</Badge> : `${days} days`}</td></tr>);
            })}</tbody>
          </table></div>
        </Card>
      )}

      {pos && pos.realizedGains.length > 0 && (
        <Card title="Realised gains" className="mt-4" pad={false}>
          <div className="overflow-x-auto"><table>
            <thead><tr><th>Sold</th><th>Bought</th><th className="r">Units</th><th className="r">Cost</th><th className="r">Proceeds</th><th className="r">Gain</th><th>Term</th></tr></thead>
            <tbody>{pos.realizedGains.map((g, i) => (
              <tr key={i}><td>{fmtDate(g.sellDate)}</td><td>{fmtDate(g.buyDate)}</td><td className="r num">{fmtUnits(g.units)}</td><td className="r num">{money(g.cost)}</td><td className="r num">{money(g.proceeds)}</td><td className={`r num ${tone(g.gain)}`}>{signedMoney(g.gain)}</td><td className="text-ink-2">{g.holdingDays > 365 ? "Long term" : "Short term"}</td></tr>
            ))}</tbody>
          </table></div>
          <p className="px-4 py-2 text-[12px] text-ink-3">Term uses the 12-month equity rule; debt funds bought after Apr 2023 are taxed at slab rate regardless.</p>
        </Card>
      )}

      <Card title="Transactions" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">{txns.length}</span>}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>Date</th><th>Type</th>{ctx.scope === "household" && <th>Profile</th>}<th>Account</th><th className="r">Units</th><th className="r">{priceLabel}</th><th className="r">Amount</th><th className="r">Charges</th><th>Source</th><th /></tr></thead>
          <tbody>{txns.map(({ t, profile, account }) => (
            <tr key={t.id}>
              <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
              <td>{TXN_LABEL[t.type]}</td>
              {ctx.scope === "household" && <td className="text-ink-2">{profile}</td>}
              <td className="text-ink-2">{account ?? "—"}</td>
              <td className="r num">{t.type === "split" ? `×${Number(t.units)}` : fmtUnits(Number(t.units))}</td>
              <td className="r num">{Number(t.price) ? fmtPrice(Number(t.price)) : "—"}</td>
              <td className="r num">{money(Number(t.amount), true)}</td>
              <td className="r num">{Number(t.fees) ? money(Number(t.fees), true) : "—"}</td>
              <td><Badge>{t.source.replace("_", " ")}</Badge></td>
              <td className="r">{canEdit && t.source === "manual" && (
                <form action={deleteTxn}><input type="hidden" name="id" value={t.id} /><button className={btnDanger} title="Delete this manual entry">Delete</button></form>
              )}</td>
            </tr>
          ))}</tbody>
          {t && <tfoot><tr><td colSpan={ctx.scope === "household" ? 6 : 5}>Net</td><td className="r num">{money(t.invested)}</td><td colSpan={3} className="text-ink-3">cost of units still held</td></tr></tfoot>}
        </table></div>
      </Card>
    </>
  );
}
