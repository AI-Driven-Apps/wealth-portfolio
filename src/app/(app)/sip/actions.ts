"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCtx, writableProfile } from "@/lib/auth/session";
import { todayIST } from "@/lib/calc/dates";
import { audit } from "@/lib/audit";

const SipInput = z.object({
  instrumentId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  stepUpPct: z.coerce.number().min(0).max(100).default(0),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function addSip(_: unknown, fd: FormData) {
  try {
    const ctx = await requireCtx("sip");
    const profileId = writableProfile(ctx);
    const v = SipInput.parse(Object.fromEntries(fd));
    const [ins] = await db.select().from(schema.instrument).where(eq(schema.instrument.id, v.instrumentId));
    if (!ins || ins.type !== "mf") return { error: "Pick a mutual fund from the list." };
    await db.insert(schema.sipPlan).values({ profileId, instrumentId: v.instrumentId, amount: v.amount.toFixed(2), dayOfMonth: v.dayOfMonth, stepUpPct: v.stepUpPct.toFixed(2), startDate: v.startDate });
    await audit(ctx.user.id, "sip.add", { profileId, instrumentId: v.instrumentId });
    revalidatePath("/sip");
    return { ok: "SIP added." };
  } catch (e) {
    return { error: e instanceof z.ZodError ? "Fill in fund, amount, day and start date." : (e as Error).message };
  }
}

export async function stopSip(fd: FormData) {
  const ctx = await requireCtx("sip");
  if (!ctx.canManage) throw new Error("View-only access.");
  const id = String(fd.get("id"));
  const resume = fd.get("resume") === "1";
  await db.update(schema.sipPlan).set(resume ? { active: true, endDate: null } : { active: false, endDate: todayIST() })
    .where(and(eq(schema.sipPlan.id, id), inArray(schema.sipPlan.profileId, ctx.profileIds)));
  await audit(ctx.user.id, resume ? "sip.resume" : "sip.stop", { id });
  revalidatePath("/sip");
}
