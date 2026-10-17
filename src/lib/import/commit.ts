import "server-only";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { buildPosition, type LedgerTxn } from "@/lib/calc/fifo";
import type { ImportPreview, ImportRow } from "./types";

type Ins = typeof schema.instrument.$inferSelect;

/** Find the instrument a row refers to: AMFI code, then ISIN, then NSE symbol. */
async function lookup(rows: ImportRow[]) {
  const amfi = [...new Set(rows.map((r) => r.amfiCode).filter(Boolean))] as string[];
  const isin = [...new Set(rows.map((r) => r.isin).filter(Boolean))] as string[];
  const sym = [...new Set(rows.map((r) => r.symbol).filter(Boolean))] as string[];
  const conds = [
    amfi.length ? inArray(schema.instrument.amfiCode, amfi) : undefined,
    isin.length ? inArray(schema.instrument.isin, isin) : undefined,
    sym.length ? and(inArray(schema.instrument.nseSymbol, sym), inArray(schema.instrument.type, ["stock", "etf"])) : undefined,
  ].filter(Boolean);
  const found = conds.length ? await db.select().from(schema.instrument).where(or(...conds)) : [];
  return (r: ImportRow): Ins | undefined =>
    (r.amfiCode && found.find((i) => i.amfiCode === r.amfiCode)) ||
    (r.isin && (found.find((i) => i.isin === r.isin && i.type !== "index"))) ||
    (r.symbol && found.find((i) => i.nseSymbol === r.symbol && (i.type === "stock" || i.type === "etf"))) ||
    undefined;
}

export interface PreviewRow extends ImportRow { instrumentName: string | null; isNew: boolean }

/** What identifies "the same holding" across rows of one file (for matching it once in the preview). */
export const identityOf = (r: Pick<ImportRow, "amfiCode" | "isin" | "symbol" | "name">) => r.amfiCode ?? r.isin ?? r.symbol ?? r.name.toLowerCase();

/** Annotate rows with the instrument they map to; for demat statements keep only the gap vs the ledger. */
export async function enrichPreview(p: ImportPreview, profileId: string): Promise<ImportPreview & { rows: PreviewRow[] }> {
  const find = await lookup(p.rows);
  let rows: PreviewRow[] = p.rows.map((r) => {
    const ins = find(r);
    return { ...r, instrumentName: ins?.name ?? null, isNew: !ins };
  });
  const missingSymbol = new Set(p.rows.map((r) => find(r)).filter((i): i is Ins => !!i && i.type !== "mf" && !i.nseSymbol && !i.yahooSymbol).map((i) => i.name));
  const warnings = [...p.warnings];

  if (p.source === "demat_cas") {
    const kept: PreviewRow[] = [];
    for (const r of rows) {
      const ins = find(r);
      let held = 0;
      if (ins) {
        const ledger = await db.select().from(schema.txn)
          .where(and(eq(schema.txn.profileId, profileId), eq(schema.txn.instrumentId, ins.id), sql`date <= ${r.date}`));
        held = buildPosition(ledger.map((t): LedgerTxn => ({ date: t.date, type: t.type, units: Number(t.units), price: Number(t.price), amount: Number(t.amount), fees: Number(t.fees) }))).units;
      }
      const gap = Math.round((r.units - held) * 1e6) / 1e6;
      if (Math.abs(gap) < 1e-4) continue;
      if (gap < 0) { warnings.push(`${r.name}: your ledger holds ${held} units but the statement shows ${r.units}. Check for a missing sale.`); continue; }
      kept.push({ ...r, units: gap, amount: gap * r.price, note: held ? `Statement ${r.units} vs ledger ${held}: adds the ${gap}-unit gap. ${r.note ?? ""}` : r.note });
    }
    if (!kept.length && rows.length) warnings.push("Your ledger already matches this statement — nothing to add.");
    rows = kept;
  }
  if (missingSymbol.size) warnings.push(`${missingSymbol.size} stock${missingSymbol.size > 1 ? "s are" : " is"} known only by ISIN (no NSE symbol), so ${missingSymbol.size > 1 ? "they" : "it"} won't get prices until the weekly "NSE equity list" job runs or you set the symbol in Admin → Data sources: ${[...missingSymbol].slice(0, 4).join(", ")}.`);
  return { ...p, rows, warnings };
}

async function ensureInstrument(r: ImportRow, find: (r: ImportRow) => Ins | undefined): Promise<Ins> {
  if (r.instrumentId) {
    // Matched by hand in the preview.
    const [picked] = await db.select().from(schema.instrument).where(eq(schema.instrument.id, r.instrumentId));
    if (!picked || picked.type === "index") throw new Error(`The instrument picked for "${r.name}" no longer exists.`);
    return picked;
  }
  const hit = find(r);
  if (hit) {
    // A tradebook tells us an ETF's NSE symbol, which AMFI doesn't publish; a stock
    // known only by ISIN (from a demat statement or a fund disclosure) gets one the same way.
    if ((hit.type === "etf" || hit.type === "stock") && !hit.nseSymbol && r.symbol) {
      // Skip if another row already owns the symbol (a duplicate the NSE-list job merges).
      const [taken] = await db.select({ id: schema.instrument.id }).from(schema.instrument)
        .where(and(eq(schema.instrument.type, hit.type), eq(schema.instrument.nseSymbol, r.symbol)));
      if (!taken) {
        await db.update(schema.instrument).set({ nseSymbol: r.symbol }).where(eq(schema.instrument.id, hit.id));
        hit.nseSymbol = r.symbol;
      }
    }
    return hit;
  }
  const looksEtf = /\bETF\b|BEES$|IETF$/i.test(`${r.name} ${r.symbol ?? ""}`);
  const type = r.assetHint === "mf" ? "mf" : r.assetHint === "etf" || looksEtf ? "etf" : "stock";
  const [row] = await db.insert(schema.instrument).values({
    type, name: r.name, isin: r.isin, amfiCode: r.amfiCode,
    nseSymbol: type === "mf" ? null : r.symbol, underlyingClass: type === "stock" ? "equity" : null,
  }).onConflictDoNothing().returning();
  if (row) return row;
  // lost a race with another insert: read it back
  const again = await lookup([r]);
  return again(r)!;
}

export async function commitImport(p: ImportPreview, profileId: string, userId: string) {
  if (!config.importsEnabled) throw new Error("Imports are switched off on this deployment.");
  const find = await lookup(p.rows);
  const [batch] = await db.insert(schema.importBatch).values({ profileId, userId, kind: p.source, filename: p.filename }).returning({ id: schema.importBatch.id });

  const accountIds = new Map<string, string>();
  const insCache = new Map<string, Ins>();
  let inserted = 0, duplicates = 0, newInstruments = 0;

  for (const r of p.rows) {
    const aKey = `${r.account.kind}|${r.account.ref}`;
    if (!accountIds.has(aKey)) {
      const [a] = await db.insert(schema.account)
        .values({ profileId, kind: r.account.kind, provider: r.account.provider, ref: r.account.ref, label: `${r.account.provider} ${r.account.ref}` })
        .onConflictDoUpdate({ target: [schema.account.profileId, schema.account.kind, schema.account.ref], set: { provider: r.account.provider } })
        .returning({ id: schema.account.id });
      accountIds.set(aKey, a.id);
    }
    const iKey = r.instrumentId ? `id:${r.instrumentId}` : identityOf(r);
    let ins = insCache.get(iKey);
    if (!ins) {
      const before = r.instrumentId ? true : find(r);
      ins = await ensureInstrument(r, find);
      if (!before) newInstruments++;
      insCache.set(iKey, ins);
    }
    const res = await db.insert(schema.txn).values({
      profileId, accountId: accountIds.get(aKey), instrumentId: ins.id, date: r.date, type: r.type,
      units: r.units.toFixed(6), price: r.price.toFixed(6), amount: r.amount.toFixed(2), fees: r.fees.toFixed(2),
      source: p.source, dedupKey: r.dedupKey, importBatchId: batch.id, notes: r.note ?? null,
    }).onConflictDoNothing().returning({ id: schema.txn.id });
    if (res.length) inserted++; else duplicates++;
  }
  const stats = { rows: p.rows.length, inserted, duplicates, newInstruments };
  await db.update(schema.importBatch).set({ stats }).where(eq(schema.importBatch.id, batch.id));
  // Stocks/ETFs without an NSE symbol get no prices: say so rather than show stale values.
  const noSymbol = [...insCache.values()].filter((i) => i.type !== "mf" && !i.nseSymbol && !i.yahooSymbol).map((i) => i.name);
  return { batchId: batch.id, ...stats, noSymbol: [...new Set(noSymbol)] };
}

/** Undo: an import batch's transactions are removed with it (FK cascade). */
export async function deleteImport(batchId: string, profileIds: string[]) {
  await db.delete(schema.importBatch).where(and(eq(schema.importBatch.id, batchId), inArray(schema.importBatch.profileId, profileIds)));
}

/** Instrument search for the manual-entry form. */
export async function searchInstruments(q: string, types: ("stock" | "mf" | "etf" | "index")[], limit = 20) {
  const term = q.trim();
  if (term.length < 2) return [];
  return db.select({ id: schema.instrument.id, name: schema.instrument.name, type: schema.instrument.type, nseSymbol: schema.instrument.nseSymbol, amfiCode: schema.instrument.amfiCode, plan: schema.instrument.plan })
    .from(schema.instrument)
    .where(and(inArray(schema.instrument.type, types), eq(schema.instrument.active, true),
      or(ilike(schema.instrument.name, `%${term}%`), ilike(schema.instrument.nseSymbol, `${term}%`), eq(schema.instrument.amfiCode, term), eq(schema.instrument.isin, term.toUpperCase()))))
    .orderBy(sql`case when ${schema.instrument.nseSymbol} ilike ${term} then 0 else 1 end`, schema.instrument.name)
    .limit(limit);
}
