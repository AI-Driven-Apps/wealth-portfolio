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
import { fetchBhav, fetchIndexCloses, fetchIndexMembers, SERIES_RANK, type BhavRow } from "@/lib/providers/nse";
import { INDEX_MEMBERS_KEY } from "@/lib/portfolio/categories";
import { getLtp, parseScripMaster, SCRIP_MASTER_URL } from "@/lib/providers/dhan";
import { extendSampleData } from "@/lib/sample";
import { runAlerts } from "@/lib/notify/alerts";
import { runScheduledBriefs } from "@/lib/agents/brief";

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

type Ins = typeof schema.instrument.$inferSelect;
const isWeekday = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) out.push(d);
  return out;
}
async function getState(key: string): Promise<string | null> {
  const [r] = await db.select().from(schema.appSetting).where(eq(schema.appSetting.key, key));
  return typeof r?.value === "string" ? r.value : null;
}
async function setState(key: string, value: string) {
  await db.insert(schema.appSetting).values({ key, value }).onConflictDoUpdate({ target: schema.appSetting.key, set: { value, updatedAt: new Date() } });
}
const isRateLimit = (e: unknown) => /too many requests|\b429\b/i.test((e as Error)?.message ?? "");

/**
 * EOD prices. NSE's own archives first: one bhavcopy per trading day prices every
 * stock, ETF, InvIT, REIT and gold bond we track (by ISIN, then symbol), and one
 * file gives the index closes. Each run loads the days since the last run, then
 * walks back through older days to fill each instrument's history from its first
 * transaction (or BACKFILL_DAYS), as far as a time budget allows; the next run
 * carries on. Yahoo is only asked for what NSE doesn't cover, and is dropped for
 * the run at its first 429 (it rate-limits most servers now).
 * Closes are raw. Returns use adj_close where an older Yahoo row has one.
 */
export const prices: JobFn = async () => {
  const deadline = Date.now() + (config.isVercel ? 90_000 : 480_000);
  const ids = await trackedIds();
  if (!ids.length) return { symbols: 0 };
  const list = await db.select().from(schema.instrument)
    .where(and(inArray(schema.instrument.type, ["stock", "etf", "index"]), inArray(schema.instrument.id, ids)));
  const today = todayIST();
  const windowStart = addDays(today, -config.backfillDays);
  const firstTxn = await db.execute<{ id: number; d: string }>(sql`select instrument_id as id, min(date)::text as d from txn group by instrument_id`);
  const firstById = new Map(firstTxn.map((r) => [Number(r.id), r.d]));
  const span = await db.select({ id: schema.priceHistory.instrumentId, lo: sql<string>`min(${schema.priceHistory.date})::text` })
    .from(schema.priceHistory).where(inArray(schema.priceHistory.instrumentId, list.map((i) => i.id))).groupBy(schema.priceHistory.instrumentId);
  const loById = new Map(span.map((r) => [r.id, r.lo]));
  const startOf = (i: Ins) => { const f = firstById.get(i.id); return addDays(f && f < windowStart ? f : windowStart, -7); };

  const listed = list.filter((i) => i.type !== "index");
  const byIsin = new Map<string, Ins[]>(), bySym = new Map<string, Ins[]>();
  for (const i of listed) {
    if (i.isin) byIsin.set(i.isin, [...(byIsin.get(i.isin) ?? []), i]);
    const sym = i.nseSymbol ?? i.yahooSymbol?.replace(/\.NS$/, "");
    if (sym) bySym.set(sym.toUpperCase(), [...(bySym.get(sym.toUpperCase()) ?? []), i]);
  }
  const indices = new Map(list.filter((i) => i.type === "index").map((i) => [(i.trackedIndex ?? i.name).toLowerCase(), i]));
  const pricedByNse = new Set<number>();
  const symbolFix = new Map<number, string>();
  let rows = 0;

  /** One trading day for every tracked instrument. null = no file (holiday / not out yet). */
  const loadDay = async (d: string, latest: boolean): Promise<boolean> => {
    const bhav = await fetchBhav(d);
    if (!bhav) return false;
    const ix = indices.size ? await fetchIndexCloses(d) : null;
    // Today's index file can lag the bhavcopy: leave today for the next run rather than skip it for good.
    if (indices.size && !ix && d === today) return false;
    const best = new Map<string, BhavRow>();
    const rank = (s: string) => { const r = SERIES_RANK.indexOf(s); return r < 0 ? 99 : r; };
    for (const r of bhav) { const b = best.get(r.isin); if (!b || rank(r.series) < rank(b.series)) best.set(r.isin, r); }
    const bySymRow = new Map([...best.values()].map((r) => [r.symbol, r]));
    const out: { instrumentId: number; date: string; close: string }[] = [];
    for (const i of listed) {
      const r = (i.isin && best.get(i.isin)) || (i.nseSymbol && bySymRow.get(i.nseSymbol.toUpperCase())) || undefined;
      if (!r) continue;
      out.push({ instrumentId: i.id, date: d, close: String(r.close) });
      pricedByNse.add(i.id);
      // Matched by ISIN under another symbol (a broker code, or a stale ticker): NSE's wins.
      if (latest && r.isin === i.isin && i.nseSymbol !== r.symbol) symbolFix.set(i.id, r.symbol);
    }
    if (ix) {
      for (const [name, i] of indices) {
        const c = ix?.get(name);
        if (c) { out.push({ instrumentId: i.id, date: d, close: String(c) }); pricedByNse.add(i.id); }
      }
    }
    if (out.length) {
      const res = await db.insert(schema.priceHistory).values(out).onConflictDoUpdate({
        target: [schema.priceHistory.instrumentId, schema.priceHistory.date],
        set: { close: sql`excluded.close` }, // keep any adj_close an earlier Yahoo fetch stored
        setWhere: sql`price_history.close is distinct from excluded.close`,
      }).returning({ d: schema.priceHistory.date });
      rows += res.length;
      if (latest) for (const o of out) await setLast(o.instrumentId, Number(o.close), d);
    }
    return true;
  };

  // 1. Days since the last run, oldest first. A missing file for today means "not out yet".
  const errors: string[] = [];
  const last = await getState("nse_bhav_last");
  // First run: a month back, which bridges any gap since prices last came from Yahoo.
  const fwdFrom = last && last >= addDays(today, -60) ? addDays(last, 1) : addDays(today, -30);
  let loaded = last, fwdDays = 0;
  for (const d of weekdays(fwdFrom, today)) {
    if (Date.now() > deadline) break;
    try {
      const ok = await loadDay(d, true);
      if (!ok && d === today) break;
      loaded = d; if (ok) fwdDays++;
    } catch (e) { errors.push(`NSE ${d}: ${(e as Error).message}`); break; }
  }
  if (loaded && loaded !== last) await setState("nse_bhav_last", loaded);
  for (const [id, sym] of symbolFix) {
    const ins = listed.find((i) => i.id === id)!;
    const [taken] = await db.select({ id: schema.instrument.id }).from(schema.instrument).where(and(eq(schema.instrument.type, ins.type), eq(schema.instrument.nseSymbol, sym)));
    if (!taken) await db.update(schema.instrument).set({ nseSymbol: sym }).where(eq(schema.instrument.id, id));
    else errors.push(`${ins.nseSymbol ?? ins.name}: NSE lists ISIN ${ins.isin} as ${sym}, which another instrument already uses; run the NSE equity list job to merge them`);
  }

  // 2. History, newest day first, back to each instrument's start.
  const firstFwd = fwdFrom;
  const need = list.map((i) => ({ i, start: startOf(i), from: i.priceHistoryFrom ?? loById.get(i.id) ?? firstFwd })).filter((n) => n.start < n.from);
  const backDays = [...new Set(need.flatMap((n) => weekdays(n.start, addDays(n.from, -1))))].sort().reverse();
  let cutoff: string | null = null, backLoaded = 0;
  for (const d of backDays) {
    if (Date.now() > deadline) break;
    try { if (await loadDay(d, false)) backLoaded++; cutoff = d; }
    catch (e) { errors.push(`NSE ${d}: ${(e as Error).message}`); break; }
  }
  const all = cutoff === backDays[backDays.length - 1];
  for (const n of need) {
    // every needed day of n on or after `cutoff` was loaded (newest first)
    const reached = all ? n.start : cutoff ? (cutoff > n.start ? cutoff : n.start) : null;
    if (reached && reached < n.from) await db.update(schema.instrument).set({ priceHistoryFrom: reached }).where(eq(schema.instrument.id, n.i.id));
  }

  // Backfilled history (an instrument merged in, or just imported) may be newer than its last price.
  await db.execute(sql`
    update instrument i set last_price = p.close, last_price_date = p.date
    from (select distinct on (instrument_id) instrument_id, date, close from price_history
          where instrument_id in (${sql.join(list.map((i) => sql`${i.id}`), sql`, `)}) order by instrument_id, date desc) p
    where p.instrument_id = i.id and (i.last_price_date is null or i.last_price_date < p.date)`);
  const fresh = new Set((await db.select({ id: schema.instrument.id }).from(schema.instrument)
    .where(and(inArray(schema.instrument.id, list.map((i) => i.id)), sql`${schema.instrument.lastPriceDate} >= ${addDays(today, -7)}`))).map((r) => r.id));

  // 3. Yahoo for anything still without a recent price: BSE-only stocks, a custom Yahoo symbol, an index NSE doesn't publish.
  let yahooBlocked = false, yahooRows = 0;
  const rest = list.filter((i) => !pricedByNse.has(i.id) && !fresh.has(i.id));
  for (const ins of rest) {
    const sym = ins.yahooSymbol ?? (ins.nseSymbol ? toYahoo(ins.nseSymbol) : null);
    if (!sym || yahooBlocked || Date.now() > deadline) continue;
    try {
      const bars = await fetchDaily(sym, startOf(ins));
      yahooRows += await upsertPrices(ins.id, bars);
      const tail = bars[bars.length - 1];
      if (tail) { await setLast(ins.id, tail.close, tail.date); if (tail.date >= addDays(today, -7)) fresh.add(ins.id); }
    } catch (e) {
      if (isRateLimit(e)) { yahooBlocked = true; errors.push("Yahoo is rate-limiting this server (HTTP 429); skipped it for this run."); }
      else errors.push(`${sym}: ${(e as Error).message}`);
    }
    await sleep(500);
  }
  // Sector is Yahoo-only and cosmetic: a few per run, never when Yahoo is refusing.
  if (!yahooBlocked) {
    for (const ins of listed.filter((i) => i.type === "stock" && !i.sector && i.nseSymbol).slice(0, 10)) {
      if (Date.now() > deadline) break;
      const sector = await fetchSector(toYahoo(ins.nseSymbol!));
      if (sector) await db.update(schema.instrument).set({ sector }).where(eq(schema.instrument.id, ins.id));
      await sleep(500);
    }
  }

  const unpriced = list.filter((i) => !pricedByNse.has(i.id) && !fresh.has(i.id)).map((i) => i.nseSymbol ?? i.yahooSymbol ?? i.name);
  return {
    symbols: list.length, rows: rows + yahooRows, nseLatest: loaded, nseNewDays: fwdDays,
    historyDaysLoaded: backLoaded, historyDaysLeft: cutoff ? backDays.length - backDays.indexOf(cutoff) - 1 : backDays.length,
    ...(unpriced.length ? { unpriced, unpricedHint: "No NSE match by ISIN or symbol. A broker code (e.g. HDFC's ...EQNR) stored as a symbol is fixed by uploading that broker's code list with a tradebook; otherwise set the symbol under Admin → Data sources." } : {}),
    ...(yahooRows ? { yahooRows } : {}),
    errors,
  };
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
    await tx.update(schema.instrumentAlias).set({ instrumentId: to }).where(eq(schema.instrumentAlias.instrumentId, from));
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

/** NIFTY 50 and F&O stock lists for the 52-week page's categories. Both change a few times a year. */
export const indexMembers: JobFn = async () => {
  const m = await fetchIndexMembers();
  // A layout change shouldn't wipe last week's good lists.
  if (m.nifty50.length < 40 || m.fno.length < 100) throw new Error(`unexpected list sizes: NIFTY 50 ${m.nifty50.length}, F&O ${m.fno.length}`);
  const value = { ...m, asOf: todayIST() };
  await db.insert(schema.appSetting).values({ key: INDEX_MEMBERS_KEY, value })
    .onConflictDoUpdate({ target: schema.appSetting.key, set: { value, updatedAt: new Date() } });
  return { nifty50: m.nifty50.length, fno: m.fno.length };
};

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
  "index-members": { fn: indexMembers, label: "NIFTY 50 + F&O stock lists (NSE, 52-week categories)", mode: "live" },
  alerts: { fn: runAlerts, label: "Discord alerts (summary, SIPs, maturities, moves, drift)", mode: "live" },
  daily: { fn: () => runDaily(), label: "Daily run: everything above in order (Vercel Cron)", mode: "live" },
  "ai-brief": { fn: runScheduledBriefs, label: "AI market brief (Claude API), for each user with the module", mode: "live", piOnly: true },
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
async function runDaily(budgetMs = 170_000): Promise<JobResult> { // the prices step alone may take ~100 s; maxDuration is 300 s
  const t0 = Date.now();
  const steps = ["scheme-master", "nav-history", "prices", "alerts"];
  if (new Date(Date.now() + 330 * 60_000).getUTCDay() === 0) steps.push("nse-equity-list", "index-members"); // Sundays, IST
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
