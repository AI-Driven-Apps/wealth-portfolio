"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createHmac, randomBytes } from "node:crypto";
import * as XLSX from "xlsx";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { requireAdmin, revokeAllSessions } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { setDhanToken } from "@/lib/providers/dhan";
import { runJob, JOBS } from "@/lib/jobs";
import { normHeader } from "@/lib/import/tabular";
import { audit } from "@/lib/audit";

const tempPassword = () => randomBytes(9).toString("base64url");
const panHash = (pan: string) => createHmac("sha256", config.panPepper || config.jwtSecret).update(pan.toUpperCase()).digest("hex");
type R = { error: string } | { ok: string } | null;

// ---------------- users ----------------

export async function createUser(_: unknown, fd: FormData): Promise<R> {
  const ctx = await requireAdmin();
  const v = z.object({
    email: z.string().email(), name: z.string().min(1).max(80), role: z.enum(["admin", "member"]),
    profileId: z.string().optional(), newProfile: z.string().max(80).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!v.success) return { error: "Enter a name and a valid email." };
  const email = v.data.email.trim().toLowerCase();
  const [ex] = await db.select().from(schema.appUser).where(eq(schema.appUser.email, email));
  if (ex) return { error: "A user with that email already exists." };
  const pw = tempPassword();
  const [u] = await db.insert(schema.appUser).values({ email, name: v.data.name, role: v.data.role, passwordHash: await hashPassword(pw), mustChangePassword: true }).returning();
  let profileId = v.data.profileId || "";
  if (!profileId && v.data.newProfile?.trim()) {
    const [p] = await db.insert(schema.profile).values({ name: v.data.newProfile.trim() }).returning();
    profileId = p.id;
  }
  if (profileId) await db.insert(schema.profileAccess).values({ userId: u.id, profileId, level: "manage" }).onConflictDoNothing();
  await audit(ctx.user.id, "user.create", { email, role: v.data.role, profileId });
  revalidatePath("/admin");
  return { ok: `Created ${email}. Temporary password: ${pw} — share it privately; they must change it at first sign-in.` };
}

export async function resetPassword(_: unknown, fd: FormData): Promise<R> {
  const ctx = await requireAdmin();
  const id = String(fd.get("id"));
  const pw = tempPassword();
  await db.update(schema.appUser).set({ passwordHash: await hashPassword(pw), mustChangePassword: true }).where(eq(schema.appUser.id, id));
  await revokeAllSessions(id);
  await audit(ctx.user.id, "user.reset_password", { id });
  return { ok: `New temporary password: ${pw}` };
}

export async function updateUser(fd: FormData) {
  const ctx = await requireAdmin();
  const id = String(fd.get("id"));
  if (id === ctx.user.id && (fd.get("role") === "member" || fd.get("isActive") === "false")) throw new Error("You can't demote or disable yourself.");
  const set: Partial<typeof schema.appUser.$inferInsert> = {};
  if (fd.has("role")) set.role = fd.get("role") === "admin" ? "admin" : "member";
  if (fd.has("isActive")) set.isActive = fd.get("isActive") === "true";
  if (Object.keys(set).length) await db.update(schema.appUser).set(set).where(eq(schema.appUser.id, id));
  if (set.isActive === false) await revokeAllSessions(id);
  if (fd.has("profileId")) {
    // Members see exactly one profile: their own.
    const pid = String(fd.get("profileId"));
    await db.delete(schema.profileAccess).where(eq(schema.profileAccess.userId, id));
    if (pid) await db.insert(schema.profileAccess).values({ userId: id, profileId: pid, level: fd.get("level") === "view" ? "view" : "manage" });
  }
  await audit(ctx.user.id, "user.update", { id, ...set, profileId: fd.get("profileId") });
  revalidatePath("/admin");
}

// ---------------- profiles ----------------

export async function createProfile(_: unknown, fd: FormData): Promise<R> {
  const ctx = await requireAdmin();
  const name = String(fd.get("name") ?? "").trim();
  const pan = String(fd.get("pan") ?? "").trim().toUpperCase();
  if (!name) return { error: "Enter a profile name." };
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { error: "PAN should look like ABCDE1234F." };
  await db.insert(schema.profile).values({ name, panHash: pan ? panHash(pan) : null, panLast4: pan ? pan.slice(-4) : null });
  await audit(ctx.user.id, "profile.create", { name });
  revalidatePath("/admin");
  return { ok: `Profile "${name}" created.` };
}

export async function renameProfile(fd: FormData) {
  const ctx = await requireAdmin();
  const id = String(fd.get("id")), name = String(fd.get("name") ?? "").trim();
  if (name) await db.update(schema.profile).set({ name }).where(eq(schema.profile.id, id));
  await audit(ctx.user.id, "profile.rename", { id, name });
  revalidatePath("/admin");
}

export async function deleteProfile(fd: FormData) {
  const ctx = await requireAdmin();
  const id = String(fd.get("id"));
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from txn where profile_id = ${id}`);
  if (Number(n) > 0) throw new Error("This profile has transactions; undo its imports first.");
  await db.delete(schema.profile).where(eq(schema.profile.id, id));
  await audit(ctx.user.id, "profile.delete", { id });
  revalidatePath("/admin");
}

// ---------------- features ----------------

export async function setGlobalFeature(fd: FormData) {
  const ctx = await requireAdmin();
  const key = String(fd.get("key")), enabled = fd.get("enabled") === "true";
  await db.update(schema.featureFlag).set({ enabled }).where(eq(schema.featureFlag.key, key));
  await audit(ctx.user.id, "feature.global", { key, enabled });
  revalidatePath("/", "layout");
}

export async function setUserFeature(fd: FormData) {
  const ctx = await requireAdmin();
  const userId = String(fd.get("userId")), key = String(fd.get("key")), enabled = fd.get("enabled") === "true";
  await db.insert(schema.userFeature).values({ userId, key, enabled })
    .onConflictDoUpdate({ target: [schema.userFeature.userId, schema.userFeature.key], set: { enabled } });
  await audit(ctx.user.id, "feature.user", { userId, key, enabled });
  revalidatePath("/admin/features");
}

// ---------------- data sources ----------------

export async function saveDhanToken(_: unknown, fd: FormData): Promise<R> {
  const ctx = await requireAdmin();
  if (config.isVercel) return { error: "Dhan isn't used on the Vercel demo." };
  const token = String(fd.get("token") ?? "").trim();
  if (token.length < 20) return { error: "That doesn't look like a Dhan access token." };
  await setDhanToken(token);
  await audit(ctx.user.id, "dhan.token");
  revalidatePath("/admin/data");
  return { ok: "Token saved. It expires 24 hours from now." };
}

/**
 * AMFI's half-yearly market-cap list (xlsx from amfiindia.com → Research → Market capitalisation).
 * Matches stocks by ISIN, then NSE symbol, and sets large / mid / small.
 */
export async function uploadCapList(_: unknown, fd: FormData): Promise<R> {
  const ctx = await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the AMFI xlsx file." };
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  let hi = -1, cIsin = -1, cSym = -1, cCat = -1, cName = -1;
  for (let r = 0; r < Math.min(grid.length, 20) && hi < 0; r++) {
    const h = grid[r].map((c) => normHeader(String(c ?? "")));
    cIsin = h.findIndex((x) => x === "isin" || x === "isincode");
    cSym = h.findIndex((x) => x.includes("nsesymbol") || x === "symbol");
    cCat = h.findIndex((x) => x.includes("categoriz") || x.includes("categoris") || x === "category" || x.includes("marketcap") && x.includes("cat"));
    cName = h.findIndex((x) => x.includes("companyname") || x === "name");
    if (cIsin >= 0 && cCat >= 0) hi = r;
  }
  if (hi < 0) return { error: "Couldn't find ISIN and categorisation columns. Use AMFI's average market capitalisation xlsx." };
  const rows = grid.slice(hi + 1).map((r) => ({
    isin: String(r[cIsin] ?? "").trim().toUpperCase(), sym: cSym >= 0 ? String(r[cSym] ?? "").trim().toUpperCase() : "",
    name: cName >= 0 ? String(r[cName] ?? "").trim() : "",
    cat: String(r[cCat] ?? "").toLowerCase(),
  })).filter((r) => /^IN[A-Z0-9]{10}$/.test(r.isin));
  let updated = 0;
  for (const cls of ["large", "mid", "small"] as const) {
    const set = rows.filter((r) => r.cat.startsWith(cls));
    for (let i = 0; i < set.length; i += 500) {
      const chunk = set.slice(i, i + 500);
      const res = await db.update(schema.instrument).set({ capClass: cls })
        .where(and(eq(schema.instrument.type, "stock"), inArray(schema.instrument.isin, chunk.map((r) => r.isin))))
        .returning({ id: schema.instrument.id });
      updated += res.length;
      const syms = chunk.map((r) => r.sym).filter(Boolean);
      if (syms.length) {
        const res2 = await db.update(schema.instrument).set({ capClass: cls })
          .where(and(eq(schema.instrument.type, "stock"), sql`${schema.instrument.isin} is null`, inArray(schema.instrument.nseSymbol, syms)))
          .returning({ id: schema.instrument.id });
        updated += res2.length;
      }
    }
  }
  await audit(ctx.user.id, "reference.caplist", { rows: rows.length, updated });
  revalidatePath("/", "layout");
  return { ok: `Read ${rows.length} companies; updated ${updated} of your stocks.` };
}

/** CSV with symbol (or isin) and sector columns. Overrides Yahoo's sector. */
export async function uploadSectors(_: unknown, fd: FormData): Promise<R> {
  const ctx = await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a CSV or XLSX file." };
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const h = (grid[0] ?? []).map((c) => normHeader(String(c ?? "")));
  const cSym = h.findIndex((x) => x === "symbol" || x === "nsesymbol"), cIsin = h.findIndex((x) => x === "isin"), cSec = h.findIndex((x) => x === "sector" || x === "industry");
  if (cSec < 0 || (cSym < 0 && cIsin < 0)) return { error: "Need a 'sector' column and a 'symbol' or 'isin' column." };
  let updated = 0;
  for (const r of grid.slice(1)) {
    const sector = String(r[cSec] ?? "").trim();
    if (!sector) continue;
    const cond = cIsin >= 0 && r[cIsin] ? eq(schema.instrument.isin, String(r[cIsin]).trim().toUpperCase()) : eq(schema.instrument.nseSymbol, String(r[cSym] ?? "").trim().toUpperCase());
    const res = await db.update(schema.instrument).set({ sector }).where(and(eq(schema.instrument.type, "stock"), cond)).returning({ id: schema.instrument.id });
    updated += res.length;
  }
  await audit(ctx.user.id, "reference.sectors", { updated });
  revalidatePath("/", "layout");
  return { ok: `Updated sector on ${updated} stocks.` };
}

export async function updateInstrument(fd: FormData) {
  const ctx = await requireAdmin();
  const id = Number(fd.get("id"));
  const s = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
  const cap = s("capClass");
  const und = s("underlyingClass");
  await db.update(schema.instrument).set({
    nseSymbol: s("nseSymbol"), sector: s("sector"),
    capClass: cap === "large" || cap === "mid" || cap === "small" ? cap : null,
    underlyingClass: und as typeof schema.instrument.$inferInsert.underlyingClass,
  }).where(eq(schema.instrument.id, id));
  await audit(ctx.user.id, "instrument.update", { id });
  revalidatePath("/", "layout");
}

// ---------------- jobs ----------------

export async function runJobNow(fd: FormData) {
  const ctx = await requireAdmin();
  const name = String(fd.get("job"));
  if (!JOBS[name]) throw new Error("Unknown job");
  await audit(ctx.user.id, "job.run", { name });
  await runJob(name);
  revalidatePath("/", "layout");
}
