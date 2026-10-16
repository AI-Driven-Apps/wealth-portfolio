"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCtx, writableProfile } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

const TxnInput = z.object({
  instrumentId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["buy", "sell", "sip", "switch_in", "switch_out", "dividend_payout", "dividend_reinvest", "bonus", "split"]),
  units: z.coerce.number().min(0),
  price: z.coerce.number().min(0),
  amount: z.coerce.number().min(0).optional(),
  fees: z.coerce.number().min(0).default(0),
  notes: z.string().max(500).optional(),
});

export async function addTxn(_: unknown, fd: FormData) {
  try {
    const ctx = await requireCtx();
    const profileId = writableProfile(ctx);
    const v = TxnInput.parse(Object.fromEntries(fd));
    if (v.date > new Date().toISOString().slice(0, 10)) return { error: "Date can't be in the future." };
    if (["buy", "sell", "sip", "switch_in", "switch_out", "dividend_reinvest", "bonus", "split"].includes(v.type) && !(v.units > 0)) return { error: "Enter the number of units (for a split, the ratio, e.g. 5 for 1→5)." };
    const amount = v.amount && v.amount > 0 ? v.amount : v.units * v.price;
    if (v.type === "dividend_payout" && !(amount > 0)) return { error: "Enter the dividend amount." };
    const [ins] = await db.select().from(schema.instrument).where(eq(schema.instrument.id, v.instrumentId));
    if (!ins) return { error: "Pick a fund or stock from the list." };
    await db.insert(schema.txn).values({
      profileId, instrumentId: v.instrumentId, date: v.date, type: v.type,
      units: v.units.toFixed(6), price: v.price.toFixed(6), amount: amount.toFixed(2), fees: v.fees.toFixed(2),
      source: "manual", dedupKey: `manual:${randomUUID()}`, notes: v.notes || null,
    });
    await audit(ctx.user.id, "txn.add", { profileId, instrumentId: v.instrumentId, type: v.type, date: v.date });
    revalidatePath("/", "layout");
    return { ok: `Saved ${v.type} of ${ins.nseSymbol ?? ins.name}.` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? "Check the highlighted fields." : (e as Error).message };
  }
}

export async function deleteTxn(fd: FormData) {
  const ctx = await requireCtx();
  if (!ctx.canManage) throw new Error("View-only access.");
  const id = String(fd.get("id"));
  await db.delete(schema.txn).where(and(eq(schema.txn.id, id), inArray(schema.txn.profileId, ctx.profileIds)));
  await audit(ctx.user.id, "txn.delete", { id });
  revalidatePath("/", "layout");
}
