import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Target } from "@/lib/calc/drift";
import { getSetting } from "@/lib/settings";

/** A profile's targets; a row without its own band uses the admin's default. */
export async function getTargets(profileId: string, defaultBand?: number): Promise<Target[]> {
  const rows = await db.select().from(schema.targetAllocation).where(eq(schema.targetAllocation.profileId, profileId));
  if (!rows.length) return [];
  const band = defaultBand ?? (await getSetting("drift_default_band"));
  return rows.map((r) => ({ assetClass: r.assetClass, targetPct: Number(r.targetPct), bandPct: r.bandPct == null ? band : Number(r.bandPct) }));
}

/** Asset classes a target can be set for. */
export const TARGET_CLASSES = ["equity", "debt", "gold", "silver", "international", "hybrid", "real_estate", "cash", "other"] as const;
