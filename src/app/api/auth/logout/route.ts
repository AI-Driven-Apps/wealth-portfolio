import { NextResponse, type NextRequest } from "next/server";
import { logout } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  await logout();
  const url = req.nextUrl.clone();
  const proto = req.headers.get("x-forwarded-proto");
  const host = req.headers.get("x-forwarded-host");
  if (proto) url.protocol = `${proto}:`;
  if (host) url.host = host;
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}
