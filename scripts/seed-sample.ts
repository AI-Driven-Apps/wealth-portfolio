// Loads the fictional sample household. Used by the Vercel demo; safe to re-run.
//   SAMPLE_PASSWORD sets the demo logins' password.
import { eq } from "drizzle-orm";
import { db, closeDb, schema, useMigrationUrl, explainDbError } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { seedSampleHousehold } from "../src/lib/sample";
import { FEATURES } from "../src/lib/features";

async function user(email: string, name: string, role: "admin" | "member", pw: string) {
  const [ex] = await db.select().from(schema.appUser).where(eq(schema.appUser.email, email));
  if (ex) return ex.id;
  const [u] = await db.insert(schema.appUser).values({ email, name, role, passwordHash: await hashPassword(pw) }).returning({ id: schema.appUser.id });
  return u.id;
}

async function main() {
  useMigrationUrl();
  const pw = process.env.SAMPLE_PASSWORD ?? "sample-portfolio-2026";
  const admin = await user("admin@sample.local", "Arun (sample admin)", "admin", pw);
  const member = await user("meera@sample.local", "Meera (sample member)", "member", pw);
  for (const f of FEATURES.filter((f) => f.built)) {
    await db.insert(schema.userFeature).values({ userId: member, key: f.key, enabled: f.key !== "imports" }).onConflictDoNothing();
  }
  const r = await seedSampleHousehold(admin, member);
  console.log("sample household:", r);
}

main().then(closeDb).catch(async (e) => {
  console.error(`\n${"seed"} failed: ${explainDbError(e)}\n`);
  console.error(e);
  await closeDb();
  process.exit(1);
});
