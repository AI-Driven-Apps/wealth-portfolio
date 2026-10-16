// Edge-safe token helpers (used by middleware): no Node APIs, no DB.
//
// One signed session cookie, 7 days, sliding. Every request also checks the
// session row in Postgres (getCtx), so signing out everywhere, a password
// change or disabling a user takes effect immediately.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "wp_session";
export const PROFILE_COOKIE = "wp_profile";
export const SESSION_TTL_SEC = 7 * 24 * 3600;
/** Re-sign the cookie once it is older than this, so active users never expire. */
export const SLIDE_AFTER_SEC = 24 * 3600;

export interface SessionClaims { sub: string; role: "admin" | "member"; name: string; sid: string; iat?: number }

function key() {
  const s = process.env.JWT_SECRET ?? "";
  if (s.length < 32) throw new Error("JWT_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function signSession(c: SessionClaims): Promise<string> {
  return new SignJWT({ role: c.role, name: c.name, sid: c.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return { sub: String(payload.sub), role: payload.role as SessionClaims["role"], name: String(payload.name ?? ""), sid: String(payload.sid ?? ""), iat: payload.iat };
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge: number) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "/";
  const secure = ["1", "true", "yes", "on"].includes((process.env.SECURE_COOKIES ?? (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase());
  return { httpOnly: true, sameSite: "lax" as const, secure, path: base, maxAge };
}
