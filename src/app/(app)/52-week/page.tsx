import { requireCtx } from "@/lib/auth/session";
import { getHoldings, getUniverse, getIndexMembers, fiftyTwoWeekRange, fiftyTwoWeekSignal, rangePosition, signalZones, type FiftyTwoWeek, type Signal } from "@/lib/portfolio/holdings";
import { CATEGORIES, SENSEX_AS_OF, categoriesOf, memberSets, type Category } from "@/lib/portfolio/categories";
import { PageHeader, Card, Stat, Badge, Empty } from "@/components/ui";
import { fmtPrice, fmtDate, pct, tone } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "52-Week Range" };

const BADGE: Record<Signal, { kind: "accent" | "loss" | "neutral"; text: string }> = {
  buy: { kind: "accent", text: "Buy" },
  sell: { kind: "loss", text: "Sell" },
  hold: { kind: "neutral", text: "Hold" },
};

// Range bar zones: near the low red, mid-range blue, near the high green.
const ZONE: Record<Signal, string> = { buy: "var(--loss)", hold: "var(--info)", sell: "var(--gain)" };

function RangeBar({ pos, w, signal, price }: { pos: number | null; w: FiftyTwoWeek | null; signal: Signal; price: number | null }) {
  if (pos == null || !w) return <span className="text-ink-3">—</span>;
  const { buyTo, sellFrom } = signalZones(w);
  const tint = (c: string) => `color-mix(in srgb, ${c} 22%, transparent)`;
  const track = `linear-gradient(to right, ${tint(ZONE.buy)} 0 ${buyTo * 100}%, ${tint(ZONE.hold)} ${buyTo * 100}% ${sellFrom * 100}%, ${tint(ZONE.sell)} ${sellFrom * 100}% 100%)`;
  return (
    <div className="relative h-4 w-32" title={`Low ${fmtPrice(w.low)} · now ${fmtPrice(price)} · high ${fmtPrice(w.high)} (${Math.round(pos * 100)}% of range)`}>
      <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-sm" style={{ background: track }} />
      <div className="absolute left-0 top-1/2 h-2.5 -translate-y-1/2 rounded-l-sm" style={{ width: `${pos * 100}%`, background: ZONE[signal] }} />
      <div className="absolute top-0 h-4 w-1 -translate-x-1/2 rounded-sm ring-2 ring-panel" style={{ left: `${pos * 100}%`, background: ZONE[signal] }} />
    </div>
  );
}

const TYPES = ["stock", "mf", "etf"] as const;
const SIGNAL_ORDER: Record<Signal, number> = { buy: 0, hold: 1, sell: 2 };
const SORTS = ["name", "price", "low", "high", "pos", "fromLow", "fromHigh", "signal"] as const;
type SortKey = (typeof SORTS)[number];

type Params = { view?: string; cat?: string; sort?: string; dir?: string };

export default async function FiftyTwoWeekPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireCtx("fifty_two_week");
  const canToggle = ctx.features.has("universe");
  const sp = await searchParams;
  const view = canToggle && sp.view === "universe" ? "universe" : "holdings";
  const cat = CATEGORIES.some((c) => c.key === sp.cat) ? (sp.cat as Category) : null;
  const sort: SortKey = (SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as SortKey) : "pos";
  const dir = sp.dir === "desc" ? "desc" : "asc";

  const href = (p: Params) => {
    const q = new URLSearchParams();
    const next = { view: view === "universe" ? "universe" : undefined, cat: cat ?? undefined, sort: sort === "pos" ? undefined : sort, dir: dir === "asc" ? undefined : dir, ...p };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `/52-week${q.size ? `?${q}` : ""}`;
  };

  const [entries, members] = await Promise.all([
    view === "universe"
      ? getUniverse(ctx.profileIds, [...TYPES])
      : getHoldings(ctx.profileIds, [...TYPES]).then((hs) => hs.map((h) => ({ instrument: h.instrument, held: true, price: h.price, priceDate: h.priceDate }))),
    getIndexMembers(),
  ]);

  const chip = (active: boolean) => `rounded-md px-2.5 py-1 ${active ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2"}`;
  const toggle = canToggle && (
    <div className="flex gap-1.5 text-[13px]">
      <Link href={href({ view: undefined })} className={chip(view === "holdings")}>Holdings</Link>
      <Link href={href({ view: "universe" })} className={chip(view === "universe")}>Full universe</Link>
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

  const sets = memberSets(members);
  const ranges = await fiftyTwoWeekRange(entries.map((e) => e.instrument.id));
  const all = entries.map((e) => {
    const w: FiftyTwoWeek | null = ranges.get(e.instrument.id) ?? null;
    return {
      e, w,
      pos: rangePosition(e.price, w),
      cats: categoriesOf(e.instrument, sets),
      fromLow: w && e.price != null ? e.price / w.low - 1 : null,
      fromHigh: w && e.price != null ? e.price / w.high - 1 : null,
      ...fiftyTwoWeekSignal(e.price, w),
    };
  });
  type Row = (typeof all)[number];

  const catCount = new Map(CATEGORIES.map((c) => [c.key, all.filter((r) => r.cats.includes(c.key)).length]));
  const displayName = (r: Row) => (r.e.instrument.nseSymbol && r.e.instrument.type !== "mf" ? r.e.instrument.nseSymbol : r.e.instrument.name);
  const key: Record<SortKey, (r: Row) => number | string | null> = {
    name: (r) => displayName(r).toLowerCase(),
    price: (r) => r.e.price,
    low: (r) => r.w?.low ?? null,
    high: (r) => r.w?.high ?? null,
    pos: (r) => r.pos,
    fromLow: (r) => r.fromLow,
    fromHigh: (r) => r.fromHigh,
    signal: (r) => SIGNAL_ORDER[r.signal],
  };
  const rows = all
    .filter((r) => !cat || r.cats.includes(cat))
    .sort((a, b) => {
      const x = key[sort](a), y = key[sort](b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // blanks last either way
      const c = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return dir === "asc" ? c : -c;
    });

  const counts = { buy: rows.filter((r) => r.signal === "buy").length, sell: rows.filter((r) => r.signal === "sell").length, hold: rows.filter((r) => r.signal === "hold").length };
  const catLabel = (k: Category) => CATEGORIES.find((c) => c.key === k)!.label;

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => {
    const active = sort === k;
    const next = active && dir === "asc" ? "desc" : "asc";
    return (
      <th className={right ? "r" : undefined} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
        <Link href={href({ sort: k, dir: next })} className={`inline-flex items-center gap-1 hover:text-ink ${active ? "font-semibold text-ink" : ""}`}>
          {children}<span className="text-[10px]">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </Link>
      </th>
    );
  };

  return (
    <>
      <PageHeader
        title="52-Week Range"
        sub={view === "universe"
          ? "Every priced instrument the system tracks, held or not, against its trailing 52-week high and low."
          : "Current price against each holding's trailing 52-week high and low. Near the low reads as a buy dip, near the high as a take-profit sell — a prompt to look closer, not advice on its own."}
        actions={toggle}
      />
      <div className="mb-4 flex flex-wrap gap-1.5 text-[13px]">
        <Link href={href({ cat: undefined })} className={chip(!cat)}>All <span className="text-ink-3">{all.length}</span></Link>
        {CATEGORIES.map((c) => (
          <Link key={c.key} href={href({ cat: c.key })} className={chip(cat === c.key)}>
            {c.label} <span className="text-ink-3">{catCount.get(c.key)}</span>
          </Link>
        ))}
      </div>
      {(cat === "nifty" || cat === "fno" || cat === "other") && !members.asOf && (
        <div className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          The NIFTY 50 and F&O lists haven't loaded yet, so those stocks show under Other. They load on the worker's next start and every Sunday{ctx.user.role === "admin" && <> — or run <b>index-members</b> now in <Link href="/admin/jobs" className="underline">Admin → Jobs</Link></>}.
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Near 52W low" value={counts.buy} sub="Buy signal" subTone={counts.buy} />
        <Stat label="Mid-range" value={counts.hold} sub="Hold" />
        <Stat label="Near 52W high" value={counts.sell} sub="Sell signal" subTone={-counts.sell} />
      </div>
      <Card
        title={`${cat ? catLabel(cat) : view === "universe" ? "Tracked universe" : "Holdings"} · ${rows.length}`}
        className="mt-4"
        pad={false}
        actions={
          <div className="flex items-center gap-3 text-[11px] text-ink-3">
            {(["buy", "hold", "sell"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ZONE[s] }} />
                {s === "buy" ? "Near low" : s === "hold" ? "Mid" : "Near high"}
              </span>
            ))}
          </div>
        }
      >
        {rows.length ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <Th k="name">Holding</Th>
                  <th>Category</th>
                  {view === "universe" && <th>Status</th>}
                  <Th k="price" right>Price</Th>
                  <Th k="low" right>52W Low</Th>
                  <Th k="high" right>52W High</Th>
                  <Th k="pos">Range</Th>
                  <Th k="fromLow" right>From low</Th>
                  <Th k="fromHigh" right>From high</Th>
                  <Th k="signal">Signal</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { e, w, pos, signal, label, fromLow, fromHigh } = r;
                  return (
                    <tr key={e.instrument.id} className="hover:bg-panel-2">
                      <td className="max-w-[300px]">
                        <Link href={`/holding/${e.instrument.id}`} className="block truncate font-medium hover:underline">{displayName(r)}</Link>
                        <div className="truncate text-[12px] text-ink-3">{e.instrument.type !== "mf" && e.instrument.nseSymbol ? e.instrument.name : e.instrument.schemeCategory ?? e.instrument.amc}</div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">{r.cats.map((c) => <Badge key={c}>{catLabel(c)}</Badge>)}</div>
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
                      <td><RangeBar pos={pos} w={w} signal={signal} price={e.price} /></td>
                      <td className={`r num ${tone(fromLow)}`}>{pct(fromLow, 1, true)}</td>
                      <td className={`r num ${tone(fromHigh)}`}>{pct(fromHigh, 1, true)}</td>
                      <td><Badge kind={BADGE[signal].kind} title={label}>{BADGE[signal].text}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-6 text-[13px] text-ink-3">Nothing in {cat ? catLabel(cat) : "this view"} here.</p>
        )}
        <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">
          NIFTY 50 and F&O lists from NSE{members.asOf ? `, as of ${fmtDate(members.asOf)}` : " (not loaded yet)"}; SENSEX list as of {SENSEX_AS_OF}.
        </p>
      </Card>
    </>
  );
}
