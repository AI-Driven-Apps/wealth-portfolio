// First admin from ADMIN_EMAIL / ADMIN_PASSWORD when the database has no users
// (as NSE-Signal does). Live data only: a sample-data deployment must never hold a
// real login, so the same env vars set for "all environments" on Vercel can't leak
// your credentials into a preview database.
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { hashPassword } from "@/lib/auth/password";

export async function bootstrapAdmin(): Promise<string> {
  if (config.isSample) return "sample data: no admin bootstrap";
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from app_user`);
  if (Number(n) > 0) return "users exist";
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return "No users yet: set ADMIN_EMAIL and ADMIN_PASSWORD and re-run to create the first admin.";
  const [u] = await db.insert(schema.appUser).values({
    email, name: process.env.ADMIN_NAME ?? "Admin", passwordHash: await hashPassword(password), role: "admin", mustChangePassword: true,
  }).returning({ id: schema.appUser.id });
  const [p] = await db.insert(schema.profile).values({ name: process.env.ADMIN_NAME ?? "My portfolio" }).returning({ id: schema.profile.id });
  await db.insert(schema.profileAccess).values({ userId: u.id, profileId: p.id, level: "manage" });
  return `created admin ${email} (must change password on first login)`;
}
