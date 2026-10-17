import { and, asc, eq } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { getHoldings } from "@/lib/portfolio/holdings";
import { visibleTypes, TYPE_LABEL } from "@/lib/portfolio/scope";
import { runWhatIf, type Alternative } from "@/lib/portfolio/whatif";
import { addYears, todayIST } from "@/lib/calc/dates";
import { CompareChart } from "@/components/charts";
import { PageHeader, Card, Empty, Notice } from "@/components/ui";
import { compact, fmtDate, money, pct, tone, shortFund } from "@/lib/format";
import { WhatIfForm, type Option } from "./form";

export const metadata = { title: "What-if" };

type SP = { h?: string; alt?: string; altId?: string; rate?: string; stop?: string };

export default async function WhatIfPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx("what_if");
  const sp = await searchParams;
  const types = visibleTypes(ctx);
  const today = todayIST();
  const holdings = await getHoldings(ctx.profileIds, types, { includeClosed: true });
  if (!holdings.length) return (<><PageHeader title="What-if" /><Empty title="Nothing to compare yet">What-if replays the cash flows of your funds and stocks, so it needs some first.</Empty></>);

  const indices = await db.select().from(schema.instrument).where(and(eq(schema.instrument.type, "index"), eq(schema.instrument.active, true))).orderBy(asc(schema.instrument.name));
  const options: Option[] = [
    { value: "all", label: "Everything (all market holdings)" },
    ...types.filter((ty) => holdings.some((h) => h.instrument.type === ty)).map((ty) => ({ value: ty, label: `All ${TYPE_LABEL[ty].toLowerCase()}` })),
    ...holdings.map((h) => ({ value: String(h.instrument.id), label: (h.instrument.type === "mf" ? shortFund(h.instrument.name) : `${h.instrument.nseSymbol ?? ""} · ${h.instrument.name}`) + (h.position.units ? "" : " (closed)"), group: TYPE_LABEL[h.instrument.type] })),
  ];
  const indexOpts: Option[] = indices.map((i) => ({ value: `i${i.id}`, label: i.name }));

  const init = { h: sp.h ?? (holdings.length === 1 ? String(holdings[0].instrument.id) : "all"), alt: sp.alt ?? (indexOpts[0]?.value ?? "fd"), altId: sp.altId ?? "", rate: sp.rate ?? "7", stop: sp.stop ?? addYears(today, -1) };
  let alt: Alternative | null = null;
  if (sp.h) {
    if (init.alt.startsWith("i") && Number(init.alt.slice(1))) alt = { kind: "instrument", id: Number(init.alt.slice(1)) };
    else if (init.alt === "pick" && Number(init.altId)) alt = { kind: "instrument", id: Number(init.altId) };
    else if (init.alt === "fd") alt = { kind: "fd", ratePct: Math.min(Math.max(Number(init.rate) || 0, 0), 20) };
    else if (init.alt === "lumpsum") alt = { kind: "lumpsum" };
    else if (init.alt === "stop" && /^\d{4}-\d{2}-\d{2}$/.test(init.stop)) alt = { kind: "stop", date: init.stop };
  }
  const r = alt ? await runWhatIf(ctx.profileIds, types, init.h, alt) : null;
  const [picked] = init.alt === "pick" && Number(init.altId) ? await db.select().from(schema.instrument).where(eq(schema.instrument.id, Number(init.altId))) : [];

  const altName = !r ? "" : r.alt.kind === "instrument" ? (r.altInstrument?.type === "mf" ? shortFund(r.altInstrument.name) : r.altInstrument?.name ?? "Alternative")
    : r.alt.kind === "fd" ? `FD at ${r.alt.ratePct}%` : r.alt.kind === "lumpsum" ? "Lump sum on day one" : `Stopped after ${fmtDate(r.alt.date)}`;
  const diff = r ? r.replay.value + r.replay.withdrawn - (r.actual.value + r.actual.withdrawn) : 0;
  const rows: [string, React.ReactNode, React.ReactNode][] = r ? [
    ["Put in", money(r.actual.invested), money(r.replay.invested)],
    ["Taken out", money(r.actual.withdrawn), money(r.replay.withdrawn)],
    ["Worth today", <b key="a">{money(r.actual.value)}</b>, <b key="b">{money(r.replay.value)}</b>],
    ["XIRR", <span key="a" className={tone(r.actual.xirr)}>{pct(r.actual.xirr)}</span>, <span key="b" className={tone(r.replay.xirr)}>{pct(r.replay.xirr)}</span>],
    ["Worst fall in price", r.drawdown.actual == null ? "—" : pct(r.drawdown.actual), r.drawdown.alternative == null ? "—" : pct(r.drawdown.alternative)],
  ] : [];

  return (
    <>
      <PageHeader title="What-if" sub="Your real dated investments and withdrawals, replayed into an alternative. Same rupees, same days: only the destination (or the timing) changes." />
      <Card><WhatIfForm basePath={config.basePath} holdings={options} indices={indexOpts} init={init} today={today}
        initialAlt={picked ? { id: picked.id, name: picked.name, type: picked.type, nseSymbol: picked.nseSymbol, plan: picked.plan } : null} /></Card>

      {sp.h && !r && <div className="mt-4"><Notice>Pick an alternative to compare with.</Notice></div>}
      {r && (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <Card title="Result" pad={false}>
              <table>
                <thead><tr><th /><th className="r">What you did</th><th className="r">{altName}</th></tr></thead>
                <tbody>{rows.map(([k, a, b]) => <tr key={k}><td className="text-ink-2">{k}</td><td className="r num">{a}</td><td className="r num">{b}</td></tr>)}</tbody>
              </table>
              <div className="border-t border-line px-4 py-3 text-[13px]">
                {Math.abs(diff) < 1 ? "No difference." : <>The alternative would have left you <b className={tone(diff)}>{money(Math.abs(diff))}</b> {diff > 0 ? "better" : "worse"} off (value today plus money taken out), since {fmtDate(r.firstDate)}.</>}
              </div>
            </Card>
            <Card title="Value over time">
              <CompareChart data={r.actual.series.map((p, i) => ({ date: p.date, a: p.value, b: r.replay.series[i]?.value ?? null }))} aLabel="What you did" bLabel={altName} />
            </Card>
          </div>
          {(r.replay.skipped.length > 0 || r.replay.shortfall > 1) && (
            <div className="mt-4 space-y-2">
              {r.replay.skipped.length > 0 && <Notice>{r.replay.skipped.length} investment{r.replay.skipped.length > 1 ? "s" : ""} ({compact(r.replay.skipped.reduce((s, f) => s - f.amount, 0))}) came before the alternative's price history starts and {r.replay.skipped.length > 1 ? "were" : "was"} left out, so the two columns don't cover the same money.{config.isSample ? "" : " History is fetched on demand; try again later if the source was slow."}</Notice>}
              {r.replay.shortfall > 1 && <Notice>You withdrew {compact(r.replay.shortfall)} more than the alternative would have been worth at the time.</Notice>}
            </div>
          )}
          <p className="mt-3 text-[12px] text-ink-3">Stocks and ETFs replay on split- and dividend-adjusted prices; funds on NAV. Taxes, exit loads and charges are not modelled. Past returns don't predict future ones; this is not financial advice.</p>
        </>
      )}
    </>
  );
}
