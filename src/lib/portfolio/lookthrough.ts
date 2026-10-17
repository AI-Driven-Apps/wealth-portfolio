import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { lookThrough, type LtDisclosure, type StockInfo } from "@/lib/lookthrough/engine";
import { assetClassOf, type Holding } from "./holdings";
import type { Instrument } from "@/lib/db/schema";

/** Latest disclosure per fund, following fund-of-fund lines down to their underlying funds. */
export async function loadDisclosures(fundIds: number[]): Promise<Map<number, LtDisclosure>> {
  const out = new Map<number, LtDisclosure>();
  let pending = [...new Set(fundIds)];
  for (let depth = 0; depth < 4 && pending.length; depth++) {
    const latest = db.select({ fundId: schema.fundHolding.fundId, m: sql<string>`max(${schema.fundHolding.asOfMonth})`.as("m") })
      .from(schema.fundHolding).where(inArray(schema.fundHolding.fundId, pending)).groupBy(schema.fundHolding.fundId).as("latest");
    const rows = await db.select({ h: schema.fundHolding }).from(schema.fundHolding)
      .innerJoin(latest, and(eq(latest.fundId, schema.fundHolding.fundId), eq(latest.m, schema.fundHolding.asOfMonth)));
    const next = new Set<number>();
    for (const { h } of rows) {
      const d = out.get(h.fundId) ?? { asOf: h.asOfMonth, lines: [] };
      d.lines.push({ holdingInstrumentId: h.holdingInstrumentId, name: h.name, isin: h.isin, kind: h.kind, sector: h.sector, weightPct: Number(h.weightPct) });
      out.set(h.fundId, d);
      if (h.kind === "fund" && h.holdingInstrumentId != null && !out.has(h.holdingInstrumentId)) next.add(h.holdingInstrumentId);
    }
    pending = [...next].filter((id) => !out.has(id));
  }
  return out;
}

export interface LookThroughView {
  lt: ReturnType<typeof lookThrough>;
  disclosures: Map<number, LtDisclosure>;
  instruments: Map<number, Instrument>;
}

/** Look-through over the given (open) holdings. */
export async function getLookThrough(holdings: Holding[]): Promise<LookThroughView> {
  const open = holdings.filter((h) => h.value > 0);
  const disclosures = await loadDisclosures(open.filter((h) => h.instrument.type !== "stock").map((h) => h.instrument.id));
  const ids = new Set<number>(open.map((h) => h.instrument.id));
  for (const [fid, d] of disclosures) { ids.add(fid); for (const l of d.lines) if (l.holdingInstrumentId != null) ids.add(l.holdingInstrumentId); }
  const rows = ids.size ? await db.select().from(schema.instrument).where(inArray(schema.instrument.id, [...ids])) : [];
  const instruments = new Map(rows.map((r) => [r.id, r]));
  const stockInfo = new Map<number, StockInfo>();
  const fundClass = new Map<number, string>();
  for (const r of rows) {
    if (r.type === "stock") stockInfo.set(r.id, { name: r.nseSymbol ? `${r.nseSymbol} · ${r.name}` : r.name, capClass: r.capClass, sector: r.sector });
    else fundClass.set(r.id, assetClassOf(r));
  }
  const lt = lookThrough(
    open.map((h) => ({ instrumentId: h.instrument.id, type: h.instrument.type as "stock" | "mf" | "etf", value: h.value, assetClass: h.assetClass })),
    disclosures, stockInfo, fundClass,
  );
  return { lt, disclosures, instruments };
}

/** Disclosure months on record for a fund, newest first. */
export async function disclosureMonths(fundId: number) {
  return db.select({ m: schema.fundHolding.asOfMonth, n: sql<number>`count(*)::int`, w: sql<string>`sum(${schema.fundHolding.weightPct})` })
    .from(schema.fundHolding).where(eq(schema.fundHolding.fundId, fundId))
    .groupBy(schema.fundHolding.asOfMonth).orderBy(desc(schema.fundHolding.asOfMonth));
}
