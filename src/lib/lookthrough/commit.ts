import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { DisclosureRow } from "./disclosure";

export interface CommitStats { lines: number; stocksMatched: number; stocksAdded: number; fundsMatched: number; fundsUnmatched: string[] }

/**
 * Stores one fund's disclosure for a month, replacing any earlier upload for
 * that month (re-uploading is safe). Stock lines are matched to instruments by
 * ISIN, and a listed company we don't know yet is added, so AMFI's cap list and
 * sector overrides apply to it as well. Fund lines (FoF) are matched to schemes
 * by ISIN, then by exact name.
 */
export async function commitDisclosure(fundId: number, asOfMonth: string, rows: DisclosureRow[]): Promise<CommitStats> {
  const stats: CommitStats = { lines: rows.length, stocksMatched: 0, stocksAdded: 0, fundsMatched: 0, fundsUnmatched: [] };
  const eqIsins = [...new Set(rows.filter((r) => r.kind === "equity" && r.isin).map((r) => r.isin!))];
  const stockByIsin = new Map<string, number>();
  if (eqIsins.length) {
    for (const r of await db.select({ id: schema.instrument.id, isin: schema.instrument.isin }).from(schema.instrument)
      .where(and(eq(schema.instrument.type, "stock"), inArray(schema.instrument.isin, eqIsins)))) stockByIsin.set(r.isin!, r.id);
    const missing = rows.filter((r) => r.kind === "equity" && r.isin && !stockByIsin.has(r.isin));
    if (missing.length) {
      const added = await db.insert(schema.instrument)
        .values([...new Map(missing.map((r) => [r.isin!, r])).values()].map((r) => ({ type: "stock" as const, name: r.name, isin: r.isin, sector: r.sector, underlyingClass: "equity" as const })))
        .returning({ id: schema.instrument.id, isin: schema.instrument.isin });
      for (const r of added) stockByIsin.set(r.isin!, r.id);
      stats.stocksAdded = added.length;
    }
  }
  const noIsin = rows.filter((r) => r.kind === "equity" && !r.isin).map((r) => r.name.toLowerCase());
  const stockByName = new Map<string, number>();
  if (noIsin.length) {
    for (const r of await db.select({ id: schema.instrument.id, name: schema.instrument.name }).from(schema.instrument)
      .where(and(eq(schema.instrument.type, "stock"), inArray(sql`lower(${schema.instrument.name})`, noIsin)))) stockByName.set(r.name.toLowerCase(), r.id);
  }
  const fundLines = rows.filter((r) => r.kind === "fund");
  const fundBy = new Map<string, number>();
  if (fundLines.length) {
    const isins = fundLines.map((r) => r.isin).filter(Boolean) as string[];
    const names = fundLines.map((r) => r.name.toLowerCase());
    const found = await db.select({ id: schema.instrument.id, isin: schema.instrument.isin, name: schema.instrument.name }).from(schema.instrument)
      .where(and(inArray(schema.instrument.type, ["mf", "etf"]),
        or(isins.length ? inArray(schema.instrument.isin, isins) : undefined, inArray(sql`lower(${schema.instrument.name})`, names))));
    for (const f of found) { if (f.isin) fundBy.set(f.isin, f.id); fundBy.set(f.name.toLowerCase(), f.id); }
  }

  const values = rows.map((r) => {
    let id: number | null = null;
    if (r.kind === "equity") {
      id = (r.isin ? stockByIsin.get(r.isin) : stockByName.get(r.name.toLowerCase())) ?? null;
      if (id != null) stats.stocksMatched++;
    } else if (r.kind === "fund") {
      id = (r.isin && fundBy.get(r.isin)) || fundBy.get(r.name.toLowerCase()) || null;
      if (id === fundId) id = null; // a fund listing itself would loop
      if (id != null) stats.fundsMatched++; else stats.fundsUnmatched.push(r.name);
    }
    return { fundId, asOfMonth, holdingInstrumentId: id, name: r.name, isin: r.isin, kind: r.kind, sector: r.sector, weightPct: r.weightPct.toFixed(4) };
  });

  await db.transaction(async (tx) => {
    await tx.delete(schema.fundHolding).where(and(eq(schema.fundHolding.fundId, fundId), eq(schema.fundHolding.asOfMonth, asOfMonth)));
    for (let i = 0; i < values.length; i += 500) await tx.insert(schema.fundHolding).values(values.slice(i, i + 500));
  });
  return stats;
}
