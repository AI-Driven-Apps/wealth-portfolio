// Jobs are plain async functions. The Pi worker calls them on a schedule
// (node-cron); Vercel Cron calls them through /api/cron/[job]; admins can run
// them from Admin → Jobs. Every job is incremental and idempotent (re-running
// is safe), the rule NSE-Signal's ingest follows too.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { addDays, todayIST } from "@/lib/calc/dates";
import { detectTrackedIndex, fetchMfapiHistory, fetchNavAll, fetchText } from "@/lib/providers/amfi";
import { fetchDaily, fetchSector, toYahoo } from "@/lib/providers/yahoo";
import { getLtp, parseScripMaster, SCRIP_MASTER_URL } from "@/lib/providers/dhan";
import { extendSampleData } from "@/lib/sample";
import { runAlerts } from "@/lib/notify/alerts";

export type JobResult = Record<string, unknown>;
type JobFn = () => Promise<JobResult>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Instruments anyone holds, plans to buy, or uses as a benchmark. Only these get history. */
async function trackedIds(): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    select distinct instrument_id as id from txn
    union select distinct instrument_id from sip_plan where active
    union select id from instrument where type = 'index' and active`);
  return rows.map((r) => Number(r.id));
}

async function upsertPrices(instrumentId: number, bars: { date: string; close: number; adjClose?: number | null }[]) {
  let n = 0;
  for (let i = 0; i < bars.length; i += 1000) {
    const chunk = bars.slice(i, i + 1000).map((b) => ({
      instrumentId, date: b.date, close: String(b.close), adjClose: b.adjClose == null ? null : String(b.adjClose),
    }));
    if (!chunk.length) continue;
    // Upsert only rows whose values changed (adjusted closes rebase after splits/dividends).
    const res = await db.insert(schema.priceHistory).values(chunk)
      .onConflictDoUpdate({
        target: [schema.priceHistory.instrumentId, schema.priceHistory.date],
        set: { close: sql`excluded.close`, adjClose: sql`excluded.adj_close` },
        setWhere: sql`price_history.close is distinct from excluded.close or price_history.adj_close is distinct from excluded.adj_close`,
      })
      .returning({ d: schema.priceHistory.date });
    n += res.length;
  }
  return n;
}

async function setLast(id: number, close: number, date: string) {
  await db.update(schema.instrument)
    .set({ lastPrice: String(close), lastPriceDate: date })
    .where(and(eq(schema.instrument.id, id), sql`(last_price_date is null or last_price_date <= ${date})`));
}

// ---------------------------------------------------------------- MF / ETF master + NAV

const planOf = (name: string) => (/direct/i.test(name) ? "direct" : /regular/i.test(name) ? "regular" : null);

export const schemeMaster: JobFn = async () => {
  const all = await fetchNavAll();
  const schemes = [...new Map(all.map((s) => [s.amfiCode, s])).values()]; // one row per code
  const tracked = new Set(await trackedIds());
  let upserted = 0;
  for (let i = 0; i < schemes.length; i += 1000) {
    const rows = schemes.slice(i, i + 1000).map((s) => {
      const bench = s.isEtf || /index/i.test(s.category ?? "") ? detectTrackedIndex(s.name) : null;
      return {
        type: (s.isEtf ? "etf" : "mf") as "etf" | "mf",
        name: s.name, amfiCode: s.amfiCode, isin: s.isinGrowth ?? s.isinReinvest,
        amc: s.amc, schemeCategory: s.category, plan: planOf(s.name),
        isFof: s.isFof, underlyingClass: s.underlying,
        capClass: s.isEtf ? null : s.capClass,
        trackedIndex: bench?.index ?? null, benchmarkYahoo: bench?.yahoo ?? null,
        // MF: NAV is the price. ETF: NAV kept apart from the traded price.
        lastPrice: s.isEtf || s.nav == null ? undefined : String(s.nav),
        lastPriceDate: s.isEtf || s.nav == null ? undefined : s.navDate ?? undefined,
        lastNav: s.nav == null ? null : String(s.nav), lastNavDate: s.navDate,
      };
    });
    await db.insert(schema.instrument).values(rows).onConflictDoUpdate({
      target: schema.instrument.amfiCode,
      targetWhere: isNotNull(schema.instrument.amfiCode),
      set: {
        name: sql`excluded.name`, isin: sql`coalesce(excluded.isin, instrument.isin)`, amc: sql`excluded.amc`,
        schemeCategory: sql`excluded.scheme_category`, plan: sql`excluded.plan`, isFof: sql`excluded.is_fof`,
        underlyingClass: sql`coalesce(instrument.underlying_class, excluded.underlying_class)`,
        trackedIndex: sql`coalesce(instrument.tracked_index, excluded.tracked_index)`,
        benchmarkYahoo: sql`coalesce(instrument.benchmark_yahoo, excluded.benchmark_yahoo)`,
        lastNav: sql`excluded.last_nav`, lastNavDate: sql`excluded.last_nav_date`,
        lastPrice: sql`case when instrument.type = 'mf' then coalesce(excluded.last_price, instrument.last_price) else instrument.last_price end`,
        lastPriceDate: sql`case when instrument.type = 'mf' then coalesce(excluded.last_price_date, instrument.last_price_date) else instrument.last_price_date end`,
      },
    });
    upserted += rows.length;
  }
  // Today's NAV straight into history for held MFs (saves an mfapi call per fund per day).
  const held = tracked.size
    ? await db.select({ id: schema.instrument.id, amfi: schema.instrument.amfiCode }).from(schema.instrument)
        .where(and(eq(schema.instrument.type, "mf"), inArray(schema.instrument.id, [...tracked])))
    : [];
  const byCode = new Map(schemes.map((s) => [s.amfiCode, s]));
  let navRows = 0;
  for (const h of held) {
    const s = h.amfi ? byCode.get(h.amfi) : undefined;
    if (s?.nav && s.navDate) navRows += await upsertPrices(h.id, [{ date: s.navDate, close: s.nav }]);
  }
  // Benchmarks for index ETFs/funds need an index instrument to hold their history.
  await ensureBenchmarks();
  return { schemes: schemes.length, upserted, heldNavRows: navRows };
};

async function ensureBenchmarks() {
  const needed = await db.selectDistinct({ y: schema.instrument.benchmarkYahoo, n: schema.instrument.trackedIndex })
    .from(schema.instrument)
    .where(and(isNotNull(schema.instrument.benchmarkYahoo), inArray(schema.instrument.id, (await trackedIds()).concat(-1))));
  for (const b of needed) {
    if (!b.y) continue;
    await db.insert(schema.instrument)
      .values({ type: "index", name: b.n ?? b.y, nseSymbol: b.y, yahooSymbol: b.y, underlyingClass: "equity" })
      .onConflictDoNothing();
  }
}

export const navHistory: JobFn = async () => {
  const ids = await trackedIds();
  if (!ids.length) return { funds: 0 };
  const funds = await db.select().from(schema.instrument)
    .where(and(eq(schema.instrument.type, "mf"), isNotNull(schema.instrument.amfiCode), inArray(schema.instrument.id, ids)));
  let rows = 0; const errors: string[] = [];
  for (const f of funds) {
    try {
      const [last] = await db.select({ d: schema.priceHistory.date }).from(schema.priceHistory)
        .where(eq(schema.priceHistory.instrumentId, f.id)).orderBy(desc(schema.priceHistory.date)).limit(1);
      // First sync pulls the full history; after that only the gap (+7 days of overlap).
      const start = f.historySyncedAt && last ? addDays(last.d, -7) : undefined;
      const hist = await fetchMfapiHistory(f.amfiCode!, start);
      rows += await upsertPrices(f.id, hist);
      const tail = hist[hist.length - 1];
      if (tail) await setLast(f.id, tail.close, tail.date);
      await db.update(schema.instrument).set({ historySyncedAt: new Date() }).where(eq(schema.instrument.id, f.id));
    } catch (e) {
      errors.push(`${f.amfiCode}: ${(e as Error).message}`);
    }
    await sleep(300);
  }
  return { funds: funds.length, rows, errors };
};

// ---------------------------------------------------------------- stocks / ETFs / indices

/**
 * EOD prices from Yahoo, written from NSE-Signal's app/ingest.py: re-fetch the
 * whole window and upsert instead of appending, because adjusted closes are
 * rebased after every split/dividend and appending would mix price scales.
 * We also keep the raw close, which is what holdings are valued at.
 */
export const prices: JobFn = async () => {
  const ids = await trackedIds();
  if (!ids.length) return { symbols: 0 };
  const list = await db.select().from(schema.instrument)
    .where(and(inArray(schema.instrument.type, ["stock", "etf", "index"]), inArray(schema.instrument.id, ids)));
  const firstTxn = await db.execute<{ id: number; d: string }>(sql`select instrument_id as id, min(date)::text as d from txn group by instrument_id`);
  const firstById = new Map(firstTxn.map((r) => [Number(r.id), r.d]));
  const windowStart = addDays(todayIST(), -config.backfillDays);
  let rows = 0; const errors: string[] = [];
  for (const ins of list) {
    const sym = ins.yahooSymbol ?? (ins.nseSymbol ? toYahoo(ins.nseSymbol) : null);
    if (!sym) continue;
    try {
      const first = firstById.get(ins.id);
      const start = addDays(first && first < windowStart ? first : windowStart, -7);
      const bars = await fetchDaily(sym, start);
      rows += await upsertPrices(ins.id, bars);
      const tail = bars[bars.length - 1];
      if (tail) await setLast(ins.id, tail.close, tail.date);
      if (ins.type === "stock" && !ins.sector) {
        const sector = await fetchSector(sym);
        if (sector) await db.update(schema.instrument).set({ sector }).where(eq(schema.instrument.id, ins.id));
      }
    } catch (e) {
      errors.push(`${sym}: ${(e as Error).message}`);
    }
    await sleep(500); // be polite to Yahoo, as NSE-Signal does
  }
  return { symbols: list.length, rows, errors };
};

/** Pi only: live LTP from Dhan during market hours. Updates last price, not history. */
export const liveQuotes: JobFn = async () => {
  if (config.isVercel) return { skipped: "vercel" };
  const ids = await trackedIds();
  if (!ids.length) return { quotes: 0 };
  const list = await db.select({ id: schema.instrument.id, sid: schema.instrument.dhanSecurityId }).from(schema.instrument)
    .where(and(inArray(schema.instrument.id, ids), isNotNull(schema.instrument.dhanSecurityId)));
  if (!list.length) return { quotes: 0, note: "no instruments mapped to Dhan ids — run dhan-scrip-master" };
  const ltp = await getLtp(list.map((l) => l.sid!));
  const today = todayIST();
  for (const l of list) {
    const p = ltp[l.sid!];
    if (p) await db.update(schema.instrument).set({ lastPrice: String(p), lastPriceDate: today }).where(eq(schema.instrument.id, l.id));
  }
  return { quotes: Object.keys(ltp).length };
};

/** Map NSE symbols to Dhan security ids from Dhan's compact scrip master (as NSE-Signal does). */
export const dhanScripMaster: JobFn = async () => {
  if (config.isVercel) return { skipped: "vercel" };
  const map = parseScripMaster(await fetchText(SCRIP_MASTER_URL, {}, 120_000));
  const list = await db.select({ id: schema.instrument.id, sym: schema.instrument.nseSymbol }).from(schema.instrument)
    .where(and(inArray(schema.instrument.type, ["stock", "etf"]), isNotNull(schema.instrument.nseSymbol)));
  let mapped = 0;
  for (const l of list) {
    const sid = map.get(l.sym!.toUpperCase());
    if (sid) { await db.update(schema.instrument).set({ dhanSecurityId: sid }).where(eq(schema.instrument.id, l.id)); mapped++; }
  }
  return { scripRows: map.size, mapped };
};

/** Best effort: NSE's equity list (symbol, name, ISIN) so stocks can be picked by name. */
export const nseEquityList: JobFn = async () => {
  const csv = await fetchText("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", {
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/128 Safari/537.36", accept: "text/csv,*/*" },
  });
  const lines = csv.split(/\r?\n/).slice(1).filter(Boolean);
  let n = 0, symbolsSet = 0;
  for (let i = 0; i < lines.length; i += 500) {
    const rows = lines.slice(i, i + 500).map((l) => l.split(",")).filter((c) => c.length >= 7 && /^IN/.test(c[6]?.trim()))
      .map((c) => ({ type: "stock" as const, nseSymbol: c[0].trim(), name: c[1].trim(), isin: c[6].trim(), underlyingClass: "equity" as const }));
    if (!rows.length) continue;
    // Stocks known only by ISIN (demat statements, fund disclosures, the cap list) get
    // their symbol here; if a row with that symbol already exists, the two are merged.
    const orphans = await db.select({ id: schema.instrument.id, isin: schema.instrument.isin }).from(schema.instrument)
      .where(and(eq(schema.instrument.type, "stock"), isNull(schema.instrument.nseSymbol), inArray(schema.instrument.isin, rows.map((r) => r.isin))));
    for (const o of orphans) {
      const r = rows.find((x) => x.isin === o.isin)!;
      const [owner] = await db.select({ id: schema.instrument.id }).from(schema.instrument)
        .where(and(eq(schema.instrument.type, "stock"), eq(schema.instrument.nseSymbol, r.nseSymbol)));
      if (owner) await mergeInstrument(o.id, owner.id);
      else await db.update(schema.instrument).set({ nseSymbol: r.nseSymbol, name: r.name }).where(eq(schema.instrument.id, o.id));
      symbolsSet++;
    }
    await db.insert(schema.instrument).values(rows).onConflictDoUpdate({
      target: [schema.instrument.type, schema.instrument.nseSymbol],
      set: { name: sql`excluded.name`, isin: sql`excluded.isin` },
    });
    n += rows.length;
  }
  return { stocks: n, symbolsSet };
};

/** Moves everything that points at instrument `from` onto `to`, then deletes `from`. */
export async function mergeInstrument(from: number, to: number) {
  await db.transaction(async (tx) => {
    await tx.update(schema.txn).set({ instrumentId: to }).where(eq(schema.txn.instrumentId, from));
    await tx.update(schema.sipPlan).set({ instrumentId: to }).where(eq(schema.sipPlan.instrumentId, from));
    await tx.update(schema.fundHolding).set({ holdingInstrumentId: to }).where(eq(schema.fundHolding.holdingInstrumentId, from));
    await tx.update(schema.fundHolding).set({ fundId: to }).where(eq(schema.fundHolding.fundId, from));
    // keep the richer record's classification
    const [a] = await tx.select().from(schema.instrument).where(eq(schema.instrument.id, from));
    await tx.update(schema.instrument).set({
      sector: sql`coalesce(${schema.instrument.sector}, ${a?.sector ?? null})`,
      capClass: sql`coalesce(${schema.instrument.capClass}, ${a?.capClass ?? null})`,
    }).where(eq(schema.instrument.id, to));
    await tx.delete(schema.instrument).where(eq(schema.instrument.id, from)); // price_history cascades
  });
}

export const sampleExtend: JobFn = async () => ({ rows: await extendSampleData() });

/**
 * Fills price history for one instrument back to `from`, on demand (a what-if
 * alternative nobody holds has none). Never in sample mode: the demo makes no outside calls.
 */
export async function ensureHistory(id: number, from: string): Promise<number> {
  if (config.isSample) return 0;
  const [ins] = await db.select().from(schema.instrument).where(eq(schema.instrument.id, id));
  if (!ins) return 0;
  const [first] = await db.select({ d: schema.priceHistory.date }).from(schema.priceHistory)
    .where(eq(schema.priceHistory.instrumentId, id)).orderBy(schema.priceHistory.date).limit(1);
  if (first && first.d <= addDays(from, 7)) return 0;
  if (ins.type === "mf" && ins.amfiCode) {
    const hist = await fetchMfapiHistory(ins.amfiCode);
    await db.update(schema.instrument).set({ historySyncedAt: new Date() }).where(eq(schema.instrument.id, id));
    return upsertPrices(id, hist);
  }
  const sym = ins.yahooSymbol ?? (ins.nseSymbol ? toYahoo(ins.nseSymbol) : null);
  return sym ? upsertPrices(id, await fetchDaily(sym, addDays(from, -7))) : 0;
}

// ---------------------------------------------------------------- registry

interface JobDef {
  fn: JobFn;
  label: string;
  /** Which DATA_MODE it belongs to: market data never touches the demo, and vice versa. */
  mode: "live" | "sample";
  /** Needs the Pi (Dhan, minute-level schedules). */
  piOnly?: boolean;
}

export const JOBS: Record<string, JobDef> = {
  "scheme-master": { fn: schemeMaster, label: "AMFI scheme list + today's NAV", mode: "live" },
  "nav-history": { fn: navHistory, label: "MF NAV history (mfapi.in)", mode: "live" },
  prices: { fn: prices, label: "Stock / ETF / index EOD prices (Yahoo)", mode: "live" },
  "live-quotes": { fn: liveQuotes, label: "Live quotes (Dhan, market hours)", mode: "live", piOnly: true },
  "dhan-scrip-master": { fn: dhanScripMaster, label: "Dhan security id mapping", mode: "live", piOnly: true },
  "nse-equity-list": { fn: nseEquityList, label: "NSE equity list (names + ISINs)", mode: "live" },
  alerts: { fn: runAlerts, label: "Discord alerts (summary, SIPs, maturities, moves, drift)", mode: "live" },
  daily: { fn: () => runDaily(), label: "Daily run: everything above in order (Vercel Cron)", mode: "live" },
  "sample-extend": { fn: sampleExtend, label: "Roll sample data forward to today", mode: "sample" },
};

/** Whether a job may run on this deployment, and why not. */
export function jobBlocked(name: string): string | null {
  const job = JOBS[name];
  if (!job) return `Unknown job ${name}`;
  if (job.mode !== config.dataMode) return `${name} only runs with DATA_MODE=${job.mode}`;
  if (job.piOnly && config.isVercel) return `${name} runs on the Pi only`;
  return null;
}

/**
 * Vercel's Hobby plan runs cron at most once a day, so one cron calls this: the
 * Pi worker's nightly jobs in dependency order. Each step is idempotent; a step
 * that would start after the time budget is left for tomorrow (and reported).
 */
async function runDaily(budgetMs = 240_000): Promise<JobResult> {
  const t0 = Date.now();
  const steps = ["scheme-master", "nav-history", "prices", "alerts"];
  if (new Date(Date.now() + 330 * 60_000).getUTCDay() === 0) steps.push("nse-equity-list"); // Sundays, IST
  const done: Record<string, string> = {}, skipped: string[] = [];
  for (const s of steps) {
    if (Date.now() - t0 > budgetMs) { skipped.push(s); continue; }
    const r = await runJob(s);
    done[s] = r.status;
  }
  return { done, skipped, seconds: Math.round((Date.now() - t0) / 1000) };
}

export async function runJob(name: string): Promise<{ id: number; status: "ok" | "error"; detail: JobResult }> {
  const blocked = jobBlocked(name);
  if (blocked) throw new Error(blocked);
  const job = JOBS[name];
  const [run] = await db.insert(schema.jobRun).values({ job: name }).returning({ id: schema.jobRun.id });
  try {
    const detail = await job.fn();
    await db.update(schema.jobRun).set({ status: "ok", finishedAt: new Date(), detail }).where(eq(schema.jobRun.id, run.id));
    return { id: run.id, status: "ok", detail };
  } catch (e) {
    const detail = { error: (e as Error).message };
    await db.update(schema.jobRun).set({ status: "error", finishedAt: new Date(), detail }).where(eq(schema.jobRun.id, run.id));
    return { id: run.id, status: "error", detail };
  }
}
