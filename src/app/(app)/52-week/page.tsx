import { requireCtx } from "@/lib/auth/session";
import { getHoldings, getUniverse, fiftyTwoWeekRange, fiftyTwoWeekSignal, rangePosition, type FiftyTwoWeek, type Signal } from "@/lib/portfolio/holdings";
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

const TYPES = ["stock", "mf", "etf"] as const;

export default async function FiftyTwoWeekPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireCtx("fifty_two_week");
  const canToggle = ctx.features.has("universe");
  const sp = await searchParams;
  const view = canToggle && sp.view === "universe" ? "universe" : "holdings";

  const entries = view === "universe"
    ? await getUniverse(ctx.profileIds, [...TYPES])
    : (await getHoldings(ctx.profileIds, [...TYPES])).map((h) => ({ instrument: h.instrument, held: true, price: h.price, priceDate: h.priceDate }));

  const toggle = canToggle && (
    <div className="flex gap-1.5 text-[13px]">
      <Link href="/52-week" className={`rounded-md px-2.5 py-1 ${view === "holdings" ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2"}`}>Holdings</Link>
      <Link href="/52-week?view=universe" className={`rounded-md px-2.5 py-1 ${view === "universe" ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2"}`}>Full universe</Link>
    </div>
  );

  if (!entries.length) {
    return (
      <>
        <PageHeader title="52-Week Range" actions={toggle} />
        <Empty title={view === "universe" ? "Nothing tracked yet" : "No holdings yet"}>
          {view === "universe" ? "No priced instruments found in the tracked universe yet." : "52-week high/low tracking needs priced holdings. Import trades first."}
        </Empty>
      </>
    );
  }

  const ranges = await fiftyTwoWeekRange(entries.map((e) => e.instrument.id));
  const rows = entries
    .map((e) => {
      const w: FiftyTwoWeek | null = ranges.get(e.instrument.id) ?? null;
      const pos = rangePosition(e.price, w);
      return { e, w, pos, ...fiftyTwoWeekSignal(e.price, w) };
    })
    .sort((a, b) => (a.pos ?? 0.5) - (b.pos ?? 0.5));

  const counts = { buy: rows.filter((r) => r.signal === "buy").length, sell: rows.filter((r) => r.signal === "sell").length, hold: rows.filter((r) => r.signal === "hold").length };

  return (
    <>
      <PageHeader
        title="52-Week Range"
        sub={view === "universe"
          ? "Every priced instrument the system tracks, held or not, against its trailing 52-week high and low."
          : "Current price against each holding's trailing 52-week high and low. Near the low reads as a buy dip, near the high as a take-profit sell — a prompt to look closer, not advice on its own."}
        actions={toggle}
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Near 52W low" value={counts.buy} sub="Buy signal" subTone={counts.buy} />
        <Stat label="Mid-range" value={counts.hold} sub="Hold" />
        <Stat label="Near 52W high" value={counts.sell} sub="Sell signal" subTone={-counts.sell} />
      </div>
      <Card title={view === "universe" ? "Tracked universe" : "Holdings"} className="mt-4" pad={false}>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Holding</th>
                {view === "universe" && <th>Status</th>}
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
              {rows.map(({ e, w, pos, signal, label }) => {
                const fromLow = w && e.price != null ? e.price / w.low - 1 : null;
                const fromHigh = w && e.price != null ? e.price / w.high - 1 : null;
                return (
                  <tr key={e.instrument.id} className="hover:bg-panel-2">
                    <td className="max-w-[300px]">
                      <Link href={`/holding/${e.instrument.id}`} className="block truncate font-medium hover:underline">{e.instrument.nseSymbol && e.instrument.type !== "mf" ? e.instrument.nseSymbol : e.instrument.name}</Link>
                      <div className="truncate text-[12px] text-ink-3">{e.instrument.type !== "mf" && e.instrument.nseSymbol ? e.instrument.name : e.instrument.schemeCategory ?? e.instrument.amc}</div>
                    </td>
                    {view === "universe" && (
                      <td>{e.held ? <Badge kind="accent">Held</Badge> : <Badge>Not held</Badge>}</td>
                    )}
                    <td className="r num">{fmtPrice(e.price)}</td>
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
