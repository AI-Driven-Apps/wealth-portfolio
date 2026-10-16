// Applies Drizzle migrations, seeds feature flags, and bootstraps the first
// admin from ADMIN_EMAIL / ADMIN_PASSWORD when no users exist (as NSE-Signal does).
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { db, closeDb, schema, useMigrationUrl, explainDbError } from "../src/lib/db";
import { FEATURES } from "../src/lib/features";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  useMigrationUrl();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");

  for (const f of FEATURES) {
    await db.insert(schema.featureFlag).values({ key: f.key, label: f.label, enabled: f.built })
      .onConflictDoUpdate({ target: schema.featureFlag.key, set: { label: f.label } });
  }
  console.log(`feature flags: ${FEATURES.length}`);

  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from app_user`);
  if (Number(n) === 0) {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      console.warn("No users yet: set ADMIN_EMAIL and ADMIN_PASSWORD and re-run to create the first admin.");
    } else {
      const [u] = await db.insert(schema.appUser).values({
        email, name: process.env.ADMIN_NAME ?? "Admin", passwordHash: await hashPassword(password), role: "admin", mustChangePassword: true,
      }).returning({ id: schema.appUser.id });
      const [p] = await db.insert(schema.profile).values({ name: process.env.ADMIN_NAME ?? "My portfolio" }).returning({ id: schema.profile.id });
      await db.insert(schema.profileAccess).values({ userId: u.id, profileId: p.id, level: "manage" });
      console.log(`created admin ${email} (must change password on first login)`);
    }
  }
}

main().then(closeDb).catch(async (e) => {
  console.error(`\n${"migrate"} failed: ${explainDbError(e)}\n`);
  console.error(e);
  await closeDb();
  process.exit(1);
});
