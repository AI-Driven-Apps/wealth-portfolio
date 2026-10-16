import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SEC, SLIDE_AFTER_SEC, cookieOptions, signSession, verifySession } from "@/lib/auth/tokens";

// Public paths (relative to basePath). Cron routes authenticate with CRON_SECRET.
const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/api\/cron\//, /^\/api\/health$/];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname; // basePath already stripped by Next
  // Pass the path on so server components can enforce "change your temporary password".
  const headers = new Headers(req.headers);
  headers.set("x-wp-path", path);
  const pass = () => NextResponse.next({ request: { headers } });
  if (PUBLIC.some((r) => r.test(path))) return pass();

  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (claims) {
    const res = pass();
    // Sliding expiry: re-sign once a day. The session row (checked in getCtx) is the real authority.
    if (claims.iat && Date.now() / 1000 - claims.iat > SLIDE_AFTER_SEC) {
      res.cookies.set(SESSION_COOKIE, await signSession(claims), cookieOptions(SESSION_TTL_SEC));
    }
    return res;
  }
  if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  // Form submits (server actions) can't follow a redirect; requireCtx sends them to /login.
  if (req.method !== "GET" && req.method !== "HEAD") return pass();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = path === "/" ? "" : `?next=${encodeURIComponent(path)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
