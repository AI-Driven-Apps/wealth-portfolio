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
  return NextResponse.json(await searchInstruments(q, [...types]));
}
