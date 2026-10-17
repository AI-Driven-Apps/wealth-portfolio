import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { FixedRecord, LoanRecord } from "./records";

// Deposits and loans from a spreadsheet. Each import is a batch, so Undo removes
// exactly what it added. A holding or loan whose name already exists in the
// profile is left alone (re-importing is safe); new prepayments and rate
// changes for an existing loan are still added.

export async function commitFixed(rows: FixedRecord[], profileId: string, userId: string, filename: string) {
  const [batch] = await db.insert(schema.importBatch).values({ profileId, userId, kind: "fixed_assets", filename }).returning({ id: schema.importBatch.id });
  let inserted = 0, duplicates = 0;
  for (const r of rows) {
    const [ex] = await db.select({ id: schema.fixedAsset.id }).from(schema.fixedAsset)
      .where(and(eq(schema.fixedAsset.profileId, profileId), eq(sql`lower(${schema.fixedAsset.name})`, r.name.toLowerCase())));
    if (ex) { duplicates++; continue; }
    await db.insert(schema.fixedAsset).values({
      profileId, kind: r.kind, name: r.name, institution: r.institution, principal: r.principal.toFixed(2), ratePct: r.ratePct.toFixed(3),
      compounding: r.compounding, payout: r.payout, startDate: r.startDate, maturityDate: r.maturityDate,
      balance: r.balance == null ? null : r.balance.toFixed(2), balanceAsOf: r.balanceAsOf, assetClass: r.assetClass, notes: r.notes,
      importBatchId: batch.id,
    });
    inserted++;
  }
  const stats = { rows: rows.length, inserted, duplicates };
  await db.update(schema.importBatch).set({ stats }).where(eq(schema.importBatch.id, batch.id));
  return stats;
}

export async function commitLoans(rows: LoanRecord[], profileId: string, userId: string, filename: string) {
  const [batch] = await db.insert(schema.importBatch).values({ profileId, userId, kind: "loans", filename }).returning({ id: schema.importBatch.id });
  let inserted = 0, duplicates = 0, events = 0;
  const unknown: string[] = [];
  for (const r of rows) {
    const [ex] = await db.select({ id: schema.loan.id }).from(schema.loan)
      .where(and(eq(schema.loan.profileId, profileId), eq(sql`lower(${schema.loan.name})`, r.name.toLowerCase())));
    let loanId = ex?.id;
    if (!loanId) {
      if (!r.principal) { unknown.push(r.name); continue; } // events for a loan that doesn't exist
      const [l] = await db.insert(schema.loan).values({
        profileId, kind: r.kind, name: r.name, lender: r.lender, principal: r.principal.toFixed(2), ratePct: r.ratePct.toFixed(3),
        tenureMonths: r.tenureMonths, emi: r.emi == null ? null : r.emi.toFixed(2), firstEmiDate: r.firstEmiDate, importBatchId: batch.id,
      }).returning({ id: schema.loan.id });
      loanId = l.id; inserted++;
    } else if (r.principal) duplicates++;
    const have = await db.select().from(schema.loanEvent).where(eq(schema.loanEvent.loanId, loanId));
    for (const e of r.events) {
      if (have.some((h) => h.date === e.date && h.kind === e.kind)) continue;
      await db.insert(schema.loanEvent).values({
        loanId, date: e.date, kind: e.kind, reduce: e.reduce, importBatchId: batch.id,
        amount: e.amount == null ? null : e.amount.toFixed(2), ratePct: e.ratePct == null ? null : e.ratePct.toFixed(3),
      });
      events++;
    }
  }
  const stats = { rows: rows.length, inserted, duplicates, events };
  await db.update(schema.importBatch).set({ stats }).where(eq(schema.importBatch.id, batch.id));
  return { ...stats, unknown };
}
