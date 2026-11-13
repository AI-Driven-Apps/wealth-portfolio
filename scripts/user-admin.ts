// Account recovery from the server shell, for when nobody can sign in.
//
//   Pi:     docker compose exec app node dist/scripts/user-admin.mjs <command>
//   local:  npm run user -- <command>
//
// Commands:
//   list                                  users, emails (as stored), status
//   set-email <current-email|id> <new>    change a sign-in email (normalised)
//   reset-password <email|id>             new temporary password, must change at sign-in
//   enable <email|id>                     re-enable a disabled user
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, closeDb, schema, useMigrationUrl } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

const norm = (e: string) => e.trim().toLowerCase();
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function find(key: string) {
  const [u] = await db.select().from(schema.appUser)
    .where(isUuid(key) ? eq(schema.appUser.id, key) : sql`lower(trim(${schema.appUser.email})) = ${norm(key)}`);
  if (!u) throw new Error(`No user matches "${key}". Run "list" to see stored emails.`);
  return u;
}

async function main() {
  useMigrationUrl();
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = await db.select().from(schema.appUser).orderBy(schema.appUser.createdAt);
    for (const u of rows) console.log(`${u.id}  [${u.email}]  ${u.role.padEnd(6)} ${u.isActive ? "active" : "DISABLED"}  ${u.name}`);
    console.log("\nEmails are shown in [brackets] so stray spaces are visible.");
  } else if (cmd === "set-email" && a && b) {
    const u = await find(a);
    const email = norm(b);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${b}" is not a valid email.`);
    const [clash] = await db.select({ id: schema.appUser.id }).from(schema.appUser).where(sql`lower(trim(${schema.appUser.email})) = ${email} and ${schema.appUser.id} <> ${u.id}`);
    if (clash) throw new Error(`Another user already has ${email}.`);
    await db.update(schema.appUser).set({ email }).where(eq(schema.appUser.id, u.id));
    await db.insert(schema.auditLog).values({ userId: null, action: "user.change_email", detail: { id: u.id, from: u.email, to: email, via: "cli" } });
    console.log(`${u.name}: sign-in email is now ${email} (password unchanged).`);
  } else if (cmd === "reset-password" && a) {
    const u = await find(a);
    const pw = randomBytes(9).toString("base64url");
    await db.update(schema.appUser).set({ passwordHash: await hashPassword(pw), mustChangePassword: true, isActive: true }).where(eq(schema.appUser.id, u.id));
    await db.update(schema.session).set({ revokedAt: new Date() }).where(eq(schema.session.userId, u.id));
    await db.insert(schema.auditLog).values({ userId: null, action: "user.reset_password", detail: { id: u.id, via: "cli" } });
    console.log(`${u.email}: temporary password ${pw}  (must be changed at sign-in)`);
  } else if (cmd === "enable" && a) {
    const u = await find(a);
    await db.update(schema.appUser).set({ isActive: true }).where(eq(schema.appUser.id, u.id));
    console.log(`${u.email} enabled.`);
  } else {
    console.log("usage: list | set-email <current-email|id> <new-email> | reset-password <email|id> | enable <email|id>");
    process.exitCode = 1;
  }
}

main().then(closeDb).catch(async (e) => { console.error((e as Error).message); await closeDb(); process.exit(1); });
