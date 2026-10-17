"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireCtx, writableProfile } from "@/lib/auth/session";
import { targetsProblem } from "@/lib/calc/drift";
import { TARGET_CLASSES } from "@/lib/portfolio/allocation";
import { audit } from "@/lib/audit";

/** Replaces the profile's targets. Blank target = class not targeted; blank band = admin default. */
export async function saveTargets(_: unknown, fd: FormData) {
  try {
    const ctx = await requireCtx("drift");
    const profileId = writableProfile(ctx);
    const rows: { assetClass: string; targetPct: number; bandPct: number | null }[] = [];
    for (const c of TARGET_CLASSES) {
      const t = String(fd.get(`t_${c}`) ?? "").trim(), b = String(fd.get(`b_${c}`) ?? "").trim();
      if (!t) continue;
      const band = b ? Number(b) : null;
      if (!Number.isFinite(Number(t)) || (band != null && !(band > 0 && band <= 50))) return { error: `Check the numbers for ${c}.` };
      if (Number(t) > 0 || band != null) rows.push({ assetClass: c, targetPct: Number(t), bandPct: band });
    }
    const problem = targetsProblem(rows);
    if (problem) return { error: problem };
    await db.transaction(async (tx) => {
      await tx.delete(schema.targetAllocation).where(eq(schema.targetAllocation.profileId, profileId));
      if (rows.length) await tx.insert(schema.targetAllocation).values(rows.map((r) => ({ profileId, assetClass: r.assetClass, targetPct: r.targetPct.toFixed(2), bandPct: r.bandPct == null ? null : r.bandPct.toFixed(2) })));
    });
    await audit(ctx.user.id, "targets.save", { profileId, rows });
    revalidatePath("/", "layout");
    return { ok: rows.length ? "Targets saved." : "Targets cleared." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
