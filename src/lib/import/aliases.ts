import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { brokerKey, type CodeEntry } from "./codes";
import type { ImportRow } from "./types";
import { mergeInstrument } from "@/lib/jobs";

type Alias = typeof schema.instrumentAlias.$inferSelect;

/** Saves a broker's code list. A code matched by hand keeps that match. */
export async function saveCodeList(broker: string, entries: CodeEntry[]) {
  const source = brokerKey(broker);
  // Code -> NSE symbol lists resolve through instruments we already have.
  const syms = [...new Set(entries.filter((e) => !e.isin && e.nseSymbol).map((e) => e.nseSymbol!))];
  const bySym = new Map<string, { id: number; isin: string | null }>();
  for (let i = 0; i < syms.length; i += 1000) {
    const found = await db.select({ id: schema.instrument.id, isin: schema.instrument.isin, sym: schema.instrument.nseSymbol }).from(schema.instrument)
      .where(and(inArray(schema.instrument.nseSymbol, syms.slice(i, i + 1000)), inArray(schema.instrument.type, ["stock", "etf"])));
    for (const f of found) bySym.set(f.sym!, f);
  }
  const values = entries.flatMap((e) => {
    const hit = e.nseSymbol ? bySym.get(e.nseSymbol) : undefined;
    if (!e.isin && !hit) return [];
    return [{ source, code: e.code, isin: e.isin ?? hit?.isin ?? null, instrumentId: e.isin ? null : hit!.id, name: e.name, origin: "list" }];
  });
  for (let i = 0; i < values.length; i += 500) {
    await db.insert(schema.instrumentAlias).values(values.slice(i, i + 500)).onConflictDoUpdate({
      target: [schema.instrumentAlias.source, schema.instrumentAlias.code],
      set: { isin: sql`excluded.isin`, instrumentId: sql`excluded.instrument_id`, name: sql`excluded.name`, updatedAt: new Date() },
      setWhere: sql`${schema.instrumentAlias.origin} = 'list'`,
    });
  }
  return { saved: values.length, unresolved: entries.length - values.length, repaired: await repairCodeSymbols(source) };
}

/**
 * A tradebook imported before its broker's codes were known created instruments
 * with the code as their NSE symbol (HDFC "IRCINTEQNR"), which never get prices.
 * Once the code is known: merge into the real instrument, or swap the code for the
 * ISIN so the prices job finds it. Only instruments without an ISIN of their own
 * (or with the same one) are touched, so a real NSE symbol that happens to equal
 * some broker code is left alone.
 */
export async function repairCodeSymbols(source: string, codes?: string[]): Promise<number> {
  const aliases = await db.select().from(schema.instrumentAlias)
    .where(codes ? and(eq(schema.instrumentAlias.source, source), inArray(schema.instrumentAlias.code, codes)) : eq(schema.instrumentAlias.source, source));
  if (!aliases.length) return 0;
  const byCode = new Map(aliases.map((a) => [a.code, a]));
  const bad: (typeof schema.instrument.$inferSelect)[] = [];
  const all = [...byCode.keys()];
  for (let i = 0; i < all.length; i += 1000) {
    bad.push(...await db.select().from(schema.instrument)
      .where(and(inArray(schema.instrument.type, ["stock", "etf"]), inArray(schema.instrument.nseSymbol, all.slice(i, i + 1000)))));
  }
  let fixed = 0;
  for (const b of bad) {
    const a = byCode.get(b.nseSymbol!)!;
    if (b.isin && b.isin !== a.isin) continue;
    if (a.instrumentId === b.id) continue;
    const [target] = a.instrumentId
      ? await db.select().from(schema.instrument).where(eq(schema.instrument.id, a.instrumentId))
      : a.isin ? await db.select().from(schema.instrument).where(and(eq(schema.instrument.isin, a.isin), inArray(schema.instrument.type, ["stock", "etf"]), sql`${schema.instrument.id} <> ${b.id}`)).limit(1) : [];
    if (target) await mergeInstrument(b.id, target.id);
    else if (a.isin) await db.update(schema.instrument).set({ isin: a.isin, nseSymbol: null, name: a.name ?? b.name }).where(eq(schema.instrument.id, b.id));
    else continue;
    fixed++;
  }
  return fixed;
}

/** Remembers a code the person matched by hand, so the next import resolves it. */
export async function learnAlias(broker: string, code: string, ins: { id: number; isin: string | null; name: string }) {
  const v = { source: brokerKey(broker), code, isin: ins.isin, instrumentId: ins.id, name: ins.name, origin: "match" };
  await db.insert(schema.instrumentAlias).values(v).onConflictDoUpdate({
    target: [schema.instrumentAlias.source, schema.instrumentAlias.code],
    set: { isin: v.isin, instrumentId: v.instrumentId, name: v.name, origin: "match", updatedAt: new Date() },
  });
  await repairCodeSymbols(v.source, [code]);
}

/**
 * Rows that name an instrument only by a code (no ISIN / AMFI code) are looked up
 * in their broker's saved codes first; a hit replaces the code with the ISIN or
 * instrument, so the code is never mistaken for an NSE symbol.
 */
export async function applyAliases(rows: ImportRow[]): Promise<{ rows: ImportRow[]; resolved: number }> {
  const want = rows.filter((r) => r.symbol && !r.isin && !r.amfiCode && !r.instrumentId);
  if (!want.length) return { rows, resolved: 0 };
  const sources = [...new Set(want.map((r) => brokerKey(r.account.provider)))];
  const codes = [...new Set(want.map((r) => r.symbol!))];
  const found: Alias[] = [];
  for (let i = 0; i < codes.length; i += 1000) {
    found.push(...await db.select().from(schema.instrumentAlias)
      .where(and(inArray(schema.instrumentAlias.source, sources), inArray(schema.instrumentAlias.code, codes.slice(i, i + 1000)))));
  }
  if (!found.length) return { rows, resolved: 0 };
  const map = new Map(found.map((a) => [`${a.source}|${a.code}`, a]));
  let resolved = 0;
  const out = rows.map((r) => {
    if (!r.symbol || r.isin || r.amfiCode || r.instrumentId) return r;
    const a = map.get(`${brokerKey(r.account.provider)}|${r.symbol}`);
    if (!a) return r;
    resolved++;
    const note = `${r.account.provider} code ${r.symbol}`;
    return {
      ...r, symbol: null, isin: a.isin ?? null, instrumentId: a.instrumentId ?? undefined,
      // the tradebook's name column, when it had one, beats the code itself
      name: r.name && r.name !== r.symbol ? r.name : a.name ?? r.name,
      note: r.note ? `${note} · ${r.note}` : note,
    };
  });
  return { rows: out, resolved };
}

export async function codeListSummary() {
  return db.select({ source: schema.instrumentAlias.source, codes: sql<number>`count(*)::int`, matched: sql<number>`count(*) filter (where ${schema.instrumentAlias.origin} = 'match')::int` })
    .from(schema.instrumentAlias).groupBy(schema.instrumentAlias.source).orderBy(schema.instrumentAlias.source);
}

export async function forgetCodes(source: string) {
  await db.delete(schema.instrumentAlias).where(eq(schema.instrumentAlias.source, source));
}
