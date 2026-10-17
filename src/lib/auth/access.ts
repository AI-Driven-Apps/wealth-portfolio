import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// No Next.js imports here: the worker (alerts job) uses this too.

export interface Access {
  features: Set<string>;
  profiles: { id: string; name: string; level: "view" | "manage" }[];
}

/**
 * What a user may see, without a request: enabled modules and profiles.
 * getCtx uses it per request; the alerts job uses it for a channel's owner.
 */
export async function accessFor(u: { id: string; role: "admin" | "member" }): Promise<Access> {
  const isAdmin = u.role === "admin";
  const flags = await db.select().from(schema.featureFlag);
  const grants = isAdmin ? [] : await db.select().from(schema.userFeature).where(eq(schema.userFeature.userId, u.id));
  const granted = new Set(grants.filter((g) => g.enabled).map((g) => g.key));
  // A module is visible only when it is on globally AND granted to the user (admins: global only).
  const features = new Set(flags.filter((f) => f.enabled && (isAdmin || granted.has(f.key))).map((f) => f.key));

  const profiles = isAdmin
    ? (await db.select().from(schema.profile).orderBy(schema.profile.name)).map((p) => ({ id: p.id, name: p.name, level: "manage" as const }))
    : (await db.select({ id: schema.profile.id, name: schema.profile.name, level: schema.profileAccess.level })
        .from(schema.profileAccess)
        .innerJoin(schema.profile, eq(schema.profile.id, schema.profileAccess.profileId))
        .where(eq(schema.profileAccess.userId, u.id))).slice(0, 1); // members: own profile only
  return { features, profiles };
}

