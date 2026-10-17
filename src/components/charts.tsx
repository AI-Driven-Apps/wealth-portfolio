"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Scatter, ReferenceLine, Area,
} from "recharts";
import { compact } from "@/lib/format";
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

const axisProps = { tick: { fill: "var(--ink-3)", fontSize: 11 }, tickLine: false } as const;

/**
 * Two rupee series over time on one axis, e.g. your actual portfolio vs a what-if,
 * or a loan balance with vs without prepayments. The second line is dashed so the
 * pair never relies on colour alone.
 */
export function CompareChart({ data, aLabel, bLabel }: { data: { date: string; a: number | null; b: number | null }[]; aLabel: string; bLabel: string }) {
  if (data.length < 2) return <div className="py-16 text-center text-ink-3">Not enough history to chart yet.</div>;
  return (
    <div>
      <div className="h-[260px] w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtAxisDate} minTickGap={48} axisLine={{ stroke: "var(--line)" }} {...axisProps} />
            <YAxis width={64} tickFormatter={(v: number) => compact(v)} axisLine={false} {...axisProps} />
            <Tooltip cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} content={({ active, payload, label: d }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as { a: number | null; b: number | null };
              return (
                <div className="rounded-lg border border-line bg-panel px-3 py-2 text-[12px] shadow-sm">
                  <div className="mb-1 font-medium">{fmtFull(String(d))}</div>
                  <div>{aLabel}: <span className="num font-semibold">{compact(row.a)}</span></div>
                  <div className="text-ink-2">{bLabel}: <span className="num">{compact(row.b)}</span></div>
                </div>
              );
            }} />
            <Line type="monotone" dataKey="a" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="b" stroke="var(--c2)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />{aLabel}</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: "var(--c2)" }} />{bLabel}</span>
      </div>
    </div>
  );
}

/** Net worth over time: assets stacked by class, net worth (after loans) as a line on the same axis. */
export function NetWorthChart({ data, keys, colors, labels }: {
  data: ({ date: string; net: number; liabilities: number } & Record<string, number | string>)[];
  keys: string[]; colors: Record<string, string>; labels: Record<string, string>;
}) {
  if (data.length < 2) return <div className="py-16 text-center text-ink-3">The trend fills in after a month of history.</div>;
  const hasLoans = data.some((d) => d.liabilities > 0);
  return (
    <div>
      <div className="h-[280px] w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtAxisDate} minTickGap={48} axisLine={{ stroke: "var(--line)" }} {...axisProps} />
            <YAxis width={64} tickFormatter={(v: number) => compact(v)} axisLine={false} {...axisProps} />
            <Tooltip cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} content={({ active, payload, label: d }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Record<string, number>;
              return (
                <div className="rounded-lg border border-line bg-panel px-3 py-2 text-[12px] shadow-sm">
                  <div className="mb-1 font-medium">{fmtFull(String(d))}</div>
                  {[...keys].reverse().filter((k) => row[k]).map((k) => (
                    <div key={k} className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ background: colors[k] }} /><span className="flex-1">{labels[k] ?? k}</span><span className="num">{compact(row[k])}</span></div>
                  ))}
                  {hasLoans && <div className="flex justify-between gap-4 text-ink-2"><span>Loans</span><span className="num">−{compact(row.liabilities)}</span></div>}
                  <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1 font-semibold"><span>Net worth</span><span className="num">{compact(row.net)}</span></div>
                </div>
              );
            }} />
            {keys.map((k) => (
              <Area key={k} type="monotone" dataKey={k} stackId="a" stroke="var(--panel)" strokeWidth={2} fill={colors[k]} fillOpacity={0.85} isAnimationActive={false} />
            ))}
            <Line type="monotone" dataKey="net" stroke="var(--ink)" strokeWidth={2} strokeDasharray={hasLoans ? "6 4" : undefined} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {keys.map((k) => <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[k] }} />{labels[k] ?? k}</span>)}
        <span className="flex items-center gap-1.5"><span className={clsx("w-4 border-t-2 border-ink", hasLoans && "border-dashed")} />Net worth{hasLoans ? " (after loans)" : ""}</span>
      </div>
    </div>
  );
}
