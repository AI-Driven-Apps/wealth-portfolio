"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Scatter, ReferenceLine,
} from "recharts";
import clsx from "clsx";

export interface ChartPoint { date: string; close: number }
export interface Marker { date: string; kind: "buy" | "sell"; units: number; price: number }

const RANGES = [
  { k: "6M", days: 182 }, { k: "1Y", days: 365 }, { k: "3Y", days: 1095 }, { k: "5Y", days: 1826 }, { k: "All", days: 0 },
] as const;

const fmtAxisDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const fmtFull = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtNum = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Price / NAV history with your buys and sells marked, plus your average cost as a reference line. */
export function PriceChart({ series, markers = [], avgCost, label = "NAV", benchmark }: {
  series: ChartPoint[]; markers?: Marker[]; avgCost?: number | null; label?: string;
  benchmark?: { name: string; series: ChartPoint[] } | null;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["k"]>(series.length > 900 ? "3Y" : "All");
  const data = useMemo(() => {
    if (!series.length) return [];
    const last = series[series.length - 1].date;
    const days = RANGES.find((r) => r.k === range)!.days;
    const from = days ? new Date(Date.parse(last) - days * 86_400_000).toISOString().slice(0, 10) : "";
    const win = series.filter((p) => p.date >= from);
    // Benchmark rebased to the fund's first value in the window, so lines start together.
    let benchMap: Map<string, number> | null = null;
    if (benchmark?.series.length && win.length) {
      const b = benchmark.series.filter((p) => p.date >= win[0].date);
      if (b.length) {
        const k = win[0].close / b[0].close;
        benchMap = new Map(b.map((p) => [p.date, p.close * k]));
      }
    }
    const buy = new Map(markers.filter((m) => m.kind === "buy").map((m) => [m.date, m]));
    const sell = new Map(markers.filter((m) => m.kind === "sell").map((m) => [m.date, m]));
    // Thin long series so the SVG stays light (~600 points max), keeping marker days.
    const step = Math.max(1, Math.floor(win.length / 600));
    return win.filter((p, i) => i % step === 0 || i === win.length - 1 || buy.has(p.date) || sell.has(p.date)).map((p) => ({
      date: p.date, close: p.close,
      bench: benchMap?.get(p.date) ?? null,
      buy: buy.has(p.date) ? p.close : null,
      sell: sell.has(p.date) ? p.close : null,
    }));
  }, [series, markers, range, benchmark]);

  if (!series.length) return <div className="py-16 text-center text-ink-3">No price history yet. It fills in after the next data sync.</div>;
  const first = data[0]?.close, lastV = data[data.length - 1]?.close;
  const chg = first && lastV ? lastV / first - 1 : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] text-ink-2">
          {label} change over period: <span className={clsx("num font-semibold", chg == null ? "" : chg >= 0 ? "text-gain" : "text-loss")}>{chg == null ? "—" : `${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(1)}%`}</span>
        </div>
        <div className="flex gap-1" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.k} onClick={() => setRange(r.k)} aria-pressed={range === r.k}
              className={clsx("rounded-md px-2 py-0.5 text-[12px]", range === r.k ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2")}>{r.k}</button>
          ))}
        </div>
      </div>
      <div className="h-[280px] w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtAxisDate} minTickGap={48} tick={{ fill: "var(--ink-3)", fontSize: 11 }} axisLine={{ stroke: "var(--line)" }} tickLine={false} />
            <YAxis domain={["auto", "auto"]} width={56} tickFormatter={fmtNum} tick={{ fill: "var(--ink-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={({ active, payload, label: d }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as { close: number; bench: number | null; buy: number | null; sell: number | null };
              return (
                <div className="rounded-lg border border-line bg-panel px-3 py-2 text-[12px] shadow-sm">
                  <div className="mb-1 font-medium">{fmtFull(String(d))}</div>
                  <div>{label}: <span className="num font-semibold">{fmtNum(row.close)}</span></div>
                  {row.bench != null && <div className="text-ink-2">{benchmark?.name} (rebased): <span className="num">{fmtNum(row.bench)}</span></div>}
                  {row.buy != null && <div className="text-gain">You bought on this day</div>}
                  {row.sell != null && <div className="text-loss">You sold on this day</div>}
                </div>
              );
            }} />
            {avgCost ? <ReferenceLine y={avgCost} stroke="var(--ink-3)" strokeDasharray="4 4" label={{ value: `Your avg ${fmtNum(avgCost)}`, position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 11 }} /> : null}
            {benchmark && <Line type="monotone" dataKey="bench" stroke="var(--c2)" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />}
            <Line type="monotone" dataKey="close" stroke="var(--accent)" strokeWidth={1.6} dot={false} isAnimationActive={false} />
            <Scatter dataKey="buy" fill="var(--gain)" shape="circle" isAnimationActive={false} />
            <Scatter dataKey="sell" fill="var(--loss)" shape="diamond" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />{label}</span>
        {benchmark && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: "var(--c2)" }} />{benchmark.name}</span>}
        {markers.some((m) => m.kind === "buy") && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gain" />Your purchases</span>}
        {markers.some((m) => m.kind === "sell") && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 bg-loss" />Your sales</span>}
        {avgCost ? <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-ink-3" />Your average cost</span> : null}
      </div>
    </div>
  );
}
