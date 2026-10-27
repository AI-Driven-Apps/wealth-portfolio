import { requireCtx } from "@/lib/auth/session";
import { getHoldings, fiftyTwoWeekRange, fiftyTwoWeekSignal, rangePosition, type FiftyTwoWeek, type Signal } from "@/lib/portfolio/holdings";
import { PageHeader, Card, Stat, Badge, Empty } from "@/components/ui";
import { fmtPrice, fmtDate, pct, tone } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "52-Week Range" };

const BADGE: Record<Signal, { kind: "accent" | "loss" | "neutral"; text: string }> = {
  buy: { kind: "accent", text: "Buy" },
  sell: { kind: "loss", text: "Sell" },
  hold: { kind: "neutral", text: "Hold" },
};

function RangeBar({ pos }: { pos: number | null }) {
  if (pos == null) return <span className="text-ink-3">—</span>;
  return (
    <div className="h-1.5 w-28 rounded-full bg-panel-2">
      <div className="relative h-full">
        <div className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-panel bg-accent" style={{ left: `${pos * 100}%` }} />
      </div>
    </div>
  );
}

export default async function FiftyTwoWeekPage() {
  const ctx = await requireCtx("fifty_two_week");
  const holdings = await getHoldings(ctx.profileIds, ["stock", "mf", "etf"]);
  if (!holdings.length) return (<><PageHeader title="52-Week Range" /><Empty title="No holdings yet">52-week high/low tracking needs priced holdings. Import trades first.</Empty></>);

  const ranges = await fiftyTwoWeekRange(holdings.map((h) => h.instrument.id));
  const rows = holdings
    .map((h) => {
      const w: FiftyTwoWeek | null = ranges.get(h.instrument.id) ?? null;
      const pos = rangePosition(h.price, w);
      return { h, w, pos, ...fiftyTwoWeekSignal(h.price, w) };
    })
    .sort((a, b) => (a.pos ?? 0.5) - (b.pos ?? 0.5));

  const counts = { buy: rows.filter((r) => r.signal === "buy").length, sell: rows.filter((r) => r.signal === "sell").length, hold: rows.filter((r) => r.signal === "hold").length };

  return (
    <>
      <PageHeader title="52-Week Range" sub="Current price against each holding's trailing 52-week high and low. Near the low reads as a buy dip, near the high as a take-profit sell — a prompt to look closer, not advice on its own." />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Near 52W low" value={counts.buy} sub="Buy signal" subTone={counts.buy} />
        <Stat label="Mid-range" value={counts.hold} sub="Hold" />
        <Stat label="Near 52W high" value={counts.sell} sub="Sell signal" subTone={-counts.sell} />
      </div>
      <Card title="Holdings" className="mt-4" pad={false}>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Holding</th>
                <th className="r">Price</th>
                <th className="r">52W Low</th>
                <th className="r">52W High</th>
                <th>Range</th>
                <th className="r">From low</th>
                <th className="r">From high</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, w, pos, signal, label }) => {
                const fromLow = w && h.price != null ? h.price / w.low - 1 : null;
                const fromHigh = w && h.price != null ? h.price / w.high - 1 : null;
                return (
                  <tr key={h.instrument.id} className="hover:bg-panel-2">
                    <td className="max-w-[300px]">
                      <Link href={`/holding/${h.instrument.id}`} className="block truncate font-medium hover:underline">{h.instrument.nseSymbol && h.instrument.type !== "mf" ? h.instrument.nseSymbol : h.instrument.name}</Link>
                      <div className="truncate text-[12px] text-ink-3">{h.instrument.type !== "mf" && h.instrument.nseSymbol ? h.instrument.name : h.instrument.schemeCategory ?? h.instrument.amc}</div>
                    </td>
                    <td className="r num">{fmtPrice(h.price)}</td>
                    <td className="r num">
                      {w ? fmtPrice(w.low) : "—"}
                      {w && <div className="text-[11px] text-ink-3">{fmtDate(w.lowDate)}</div>}
                    </td>
                    <td className="r num">
                      {w ? fmtPrice(w.high) : "—"}
                      {w && <div className="text-[11px] text-ink-3">{fmtDate(w.highDate)}</div>}
                    </td>
                    <td><RangeBar pos={pos} /></td>
                    <td className={`r num ${tone(fromLow)}`}>{pct(fromLow, 1, true)}</td>
                    <td className={`r num ${tone(fromHigh)}`}>{pct(fromHigh, 1, true)}</td>
                    <td><Badge kind={BADGE[signal].kind} title={label}>{BADGE[signal].text}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
