// Applies Drizzle migrations, seeds feature flags, and (live data only) bootstraps
// the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when no users exist.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { db, closeDb, schema, useMigrationUrl, explainDbError } from "../src/lib/db";
import { FEATURES } from "../src/lib/features";
import { bootstrapAdmin } from "../src/lib/bootstrap";

async function main() {
  useMigrationUrl();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");

  for (const f of FEATURES) {
    await db.insert(schema.featureFlag).values({ key: f.key, label: f.label, enabled: f.built })
      .onConflictDoUpdate({ target: schema.featureFlag.key, set: { label: f.label } });
  }
  console.log(`feature flags: ${FEATURES.length}`);

  // A module built since the last migrate is switched on once, so an upgrade doesn't
  // leave new pages hidden. Anything the admin turns off afterwards stays off.
  const [prev] = await db.select().from(schema.appSetting).where(sql`key = 'features_built'`);
  const known = new Set((prev?.value as string[] | undefined) ?? FEATURES.filter((f) => f.built && f.phase <= 3).map((f) => f.key));
  const fresh = FEATURES.filter((f) => f.built && !known.has(f.key)).map((f) => f.key);
  for (const key of fresh) await db.update(schema.featureFlag).set({ enabled: true }).where(sql`key = ${key}`);
  const built = FEATURES.filter((f) => f.built).map((f) => f.key);
  await db.insert(schema.appSetting).values({ key: "features_built", value: built })
    .onConflictDoUpdate({ target: schema.appSetting.key, set: { value: built, updatedAt: new Date() } });
  if (fresh.length) console.log(`new modules switched on: ${fresh.join(", ")} (members still need a grant in Admin -> Features)`);

  console.log(await bootstrapAdmin());

}

main().then(closeDb).catch(async (e) => {
  console.error(`\n${"migrate"} failed: ${explainDbError(e)}\n`);
  console.error(e);
  await closeDb();
  process.exit(1);
});
