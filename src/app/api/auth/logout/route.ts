import { NextResponse, type NextRequest } from "next/server";
import { logout } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  await logout();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url, { status: 303 });
}
