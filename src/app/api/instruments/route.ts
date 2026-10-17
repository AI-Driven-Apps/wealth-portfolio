import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth/session";
import { searchInstruments } from "@/lib/import/commit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const types = (["mf", "stock", "etf"] as const).filter((t) =>
    t === "mf" ? ctx.features.has("mf") : t === "stock" ? ctx.features.has("equity") : ctx.features.has("etf"));
  // What-if alternatives may also be an index (Nifty 50 etc.).
  const withIndex = req.nextUrl.searchParams.get("index") === "1" && ctx.features.has("what_if");
  return NextResponse.json(await searchInstruments(q, withIndex ? [...types, "index"] : [...types]));
}
