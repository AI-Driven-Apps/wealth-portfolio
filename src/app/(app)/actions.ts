"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { requireCtx, revokeAllSessions, logout } from "@/lib/auth/session";
import { PROFILE_COOKIE } from "@/lib/auth/tokens";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";

export async function setScope(fd: FormData) {
  const ctx = await requireCtx();
  const want = String(fd.get("scope") ?? "");
  const ok = (want === "household" && ctx.user.role === "admin") || ctx.profiles.some((p) => p.id === want);
  if (ok) (await cookies()).set(PROFILE_COOKIE, want, { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: config.basePath || "/", maxAge: 365 * 86400 });
  revalidatePath("/", "layout");
}

export async function changePassword(_: unknown, fd: FormData) {
  const ctx = await requireCtx();
  const current = String(fd.get("current") ?? ""), next = String(fd.get("next") ?? ""), confirm = String(fd.get("confirm") ?? "");
  const [u] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, ctx.user.id));
  if (!(await verifyPassword(u.passwordHash, current))) return { error: "Current password is wrong." };
  if (next !== confirm) return { error: "New passwords don't match." };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  await db.update(schema.appUser).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(schema.appUser.id, u.id));
  await audit(u.id, "password.change");
  await revokeAllSessions(u.id);
  await logout();
  redirect("/login");
}
