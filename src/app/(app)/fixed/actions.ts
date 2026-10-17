"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCtx, writableProfile } from "@/lib/auth/session";
import { todayIST } from "@/lib/calc/dates";
import { TARGET_CLASSES } from "@/lib/portfolio/allocation";
import { audit } from "@/lib/audit";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optIso = z.union([iso, z.literal("")]).optional().transform((v) => v || null);
const optNum = z.union([z.coerce.number(), z.literal("")]).optional().transform((v) => (v === "" || v == null ? null : Number(v)));

const FixedInput = z.object({
  kind: z.enum(["fd", "rd", "bond", "ppf", "epf", "nps", "sgb", "gold", "reit", "cash", "other"]),
  name: z.string().trim().min(1).max(120),
  institution: z.string().trim().max(120).optional(),
  principal: optNum,
  ratePct: z.coerce.number().min(0).max(50).default(0),
  compounding: z.enum(["monthly", "quarterly", "half_yearly", "yearly", "simple"]).default("quarterly"),
  payout: z.string().optional(),
  startDate: iso,
  maturityDate: optIso,
  balance: optNum,
  balanceAsOf: optIso,
  assetClass: z.union([z.enum(TARGET_CLASSES), z.literal("")]).optional(),
  notes: z.string().max(500).optional(),
});

export async function addFixed(_: unknown, fd: FormData) {
  try {
    const ctx = await requireCtx("other");
    const profileId = writableProfile(ctx);
    const v = FixedInput.parse(Object.fromEntries(fd));
    if (v.balance == null && !(v.principal && v.principal > 0)) return { error: v.kind === "rd" ? "Enter the monthly instalment." : "Enter the amount invested, or a current balance." };
    if (v.balance != null && v.balance < 0) return { error: "Balance can't be negative." };
    if (v.maturityDate && v.maturityDate <= v.startDate) return { error: "Maturity must be after the start date." };
    if (v.kind === "rd" && !v.maturityDate) return { error: "An RD needs a maturity date (it sets how many instalments you pay)." };
    await db.insert(schema.fixedAsset).values({
      profileId, kind: v.kind, name: v.name, institution: v.institution || null,
      principal: (v.principal ?? 0).toFixed(2), ratePct: v.ratePct.toFixed(3), compounding: v.compounding,
      payout: v.payout === "on", startDate: v.startDate, maturityDate: v.maturityDate,
      balance: v.balance == null ? null : v.balance.toFixed(2), balanceAsOf: v.balance == null ? null : v.balanceAsOf ?? todayIST(),
      assetClass: v.assetClass || null, notes: v.notes || null,
    });
    await audit(ctx.user.id, "fixed.add", { profileId, kind: v.kind, name: v.name });
    revalidatePath("/", "layout");
    return { ok: `Added ${v.name}.` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? "Check the name, dates and amounts." : (e as Error).message };
  }
}

async function owned(id: string) {
  const ctx = await requireCtx("other");
  if (!ctx.canManage) throw new Error("View-only access.");
  return { ctx, where: and(eq(schema.fixedAsset.id, id), inArray(schema.fixedAsset.profileId, ctx.profileIds)) };
}

/** Mark matured / withdrawn (stops counting it), or reopen. */
export async function closeFixed(fd: FormData) {
  const id = String(fd.get("id"));
  const { ctx, where } = await owned(id);
  const reopen = fd.get("reopen") === "1";
  await db.update(schema.fixedAsset).set({ closedOn: reopen ? null : todayIST() }).where(where);
  await audit(ctx.user.id, reopen ? "fixed.reopen" : "fixed.close", { id });
  revalidatePath("/", "layout");
}

export async function deleteFixed(fd: FormData) {
  const id = String(fd.get("id"));
  const { ctx, where } = await owned(id);
  await db.delete(schema.fixedAsset).where(where);
  await audit(ctx.user.id, "fixed.delete", { id });
  revalidatePath("/", "layout");
}

/** New statement balance for EPF/PPF/NPS/gold/cash: value grows from here at the stated rate. */
export async function updateBalance(fd: FormData) {
  const id = String(fd.get("id"));
  const { ctx, where } = await owned(id);
  const balance = Number(fd.get("balance"));
  const asOf = String(fd.get("asOf") || todayIST());
  if (!(balance >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Enter a balance and date.");
  await db.update(schema.fixedAsset).set({ balance: balance.toFixed(2), balanceAsOf: asOf }).where(where);
  await audit(ctx.user.id, "fixed.balance", { id, asOf });
  revalidatePath("/", "layout");
}
