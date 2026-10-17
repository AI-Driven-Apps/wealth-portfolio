import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SESSION_COOKIE, PROFILE_COOKIE, SESSION_TTL_SEC, cookieOptions, signSession, verifySession } from "./tokens";
import { verifyPassword } from "./password";
import { audit } from "@/lib/audit";
import { accessFor } from "./access";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- login rate limit: 5 failures / 15 min per IP (same policy as NSE-Signal) ----
// Counted from the audit log, not memory: on Vercel every serverless instance
// would otherwise keep its own counter and the limit would barely apply.
async function rateLimited(ip: string): Promise<boolean> {
  const [{ n }] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from audit_log
    where action = 'login.fail' and detail->>'ip' = ${ip} and at > now() - interval '15 minutes'`);
  return Number(n) >= 5;
}
async function noteFailure(ip: string, email: string) {
  await audit(null, "login.fail", { ip, email: email.trim().toLowerCase().slice(0, 120) });
}

async function clientIp() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = await clientIp();
  if (await rateLimited(ip)) return { ok: false, error: "Too many attempts. Try again in 15 minutes." };
  const [user] = await db.select().from(schema.appUser).where(eq(schema.appUser.email, email.trim().toLowerCase()));
  if (!user || !user.isActive || !(await verifyPassword(user.passwordHash, password))) {
    await noteFailure(ip, email);
    return { ok: false, error: "Email or password is wrong." };
  }
  const [s] = await db.insert(schema.session).values({
    userId: user.id, refreshHash: sha256(randomBytes(32).toString("hex")),
    expiresAt: new Date(Date.now() + SESSION_TTL_SEC * 1000),
  }).returning({ id: schema.session.id });
  await db.update(schema.appUser).set({ lastLoginAt: new Date() }).where(eq(schema.appUser.id, user.id));
  (await cookies()).set(SESSION_COOKIE, await signSession({ sub: user.id, role: user.role, name: user.name, sid: s.id }), cookieOptions(SESSION_TTL_SEC));
  await audit(user.id, "login", { ip });
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (claims && /^[0-9a-f-]{36}$/.test(claims.sid)) {
    await db.update(schema.session).set({ revokedAt: new Date() }).where(eq(schema.session.id, claims.sid));
  }
  for (const c of [SESSION_COOKIE, PROFILE_COOKIE]) jar.set(c, "", cookieOptions(0));
}

export async function revokeAllSessions(userId: string) {
  await db.update(schema.session).set({ revokedAt: new Date() }).where(and(eq(schema.session.userId, userId), isNull(schema.session.revokedAt)));
}

// ---------------- request context ----------------

export interface Ctx {
  user: { id: string; name: string; email: string; role: "admin" | "member"; mustChangePassword: boolean };
  features: Set<string>;
  profiles: { id: string; name: string; level: "view" | "manage" }[];
  /** Selected profile id, or "household" (admin only). */
  scope: string;
  /** Profile ids the current page should aggregate. */
  profileIds: string[];
  canManage: boolean;
}

export async function getCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!claims || !/^[0-9a-f-]{36}$/.test(claims.sid)) return null;
  // The session row is the authority: signing out everywhere, a password change or
  // disabling a user takes effect on the very next request.
  const [row] = await db.select({ u: schema.appUser, s: schema.session })
    .from(schema.session)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.session.userId))
    .where(and(eq(schema.session.id, claims.sid), eq(schema.session.userId, claims.sub)));
  if (!row || row.s.revokedAt || row.s.expiresAt < new Date() || !row.u.isActive) return null;
  // Sliding expiry, written at most once a day.
  if (row.s.expiresAt.getTime() - Date.now() < (SESSION_TTL_SEC - 86_400) * 1000) {
    await db.update(schema.session).set({ expiresAt: new Date(Date.now() + SESSION_TTL_SEC * 1000) }).where(eq(schema.session.id, row.s.id));
  }
  const u = row.u;

  const isAdmin = u.role === "admin";
  const { features, profiles } = await accessFor(u);

  const wanted = jar.get(PROFILE_COOKIE)?.value;
  let scope: string;
  if (isAdmin && wanted === "household") scope = "household";
  else if (wanted && profiles.some((p) => p.id === wanted)) scope = wanted;
  else scope = profiles[0]?.id ?? "";
  const profileIds = scope === "household" ? profiles.map((p) => p.id) : scope ? [scope] : [];
  const level = profiles.find((p) => p.id === scope)?.level;

  return {
    user: { id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: u.mustChangePassword },
    features, profiles, scope, profileIds,
    canManage: isAdmin || level === "manage",
  };
}

export async function requireCtx(feature?: string): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (ctx.user.mustChangePassword) {
    const path = (await headers()).get("x-wp-path") ?? "";
    if (path !== "/account") redirect("/account");
  }
  if (feature && !ctx.features.has(feature)) redirect("/?denied=" + feature);
  return ctx;
}

export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireCtx();
  if (ctx.user.role !== "admin") redirect("/");
  return ctx;
}

/** For writes: the single profile being written to. Household view is read-only. */
export function writableProfile(ctx: Ctx): string {
  if (ctx.scope === "household" || !ctx.scope) throw new Error("Pick a single profile before adding or importing.");
  if (!ctx.canManage) throw new Error("You have view-only access to this profile.");
  return ctx.scope;
}
