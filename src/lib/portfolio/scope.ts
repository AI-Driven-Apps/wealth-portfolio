import type { Ctx } from "@/lib/auth/session";
import type { AssetType } from "./holdings";

/** Asset types the user can see, from their enabled modules. */
export function visibleTypes(ctx: Ctx): AssetType[] {
  const t: AssetType[] = [];
  if (ctx.features.has("mf") || ctx.features.has("sip") || ctx.features.has("fof")) t.push("mf");
  if (ctx.features.has("equity")) t.push("stock");
  if (ctx.features.has("etf")) t.push("etf");
  return t;
}

export const TYPE_LABEL: Record<string, string> = { mf: "Mutual funds", stock: "Stocks", etf: "ETFs" };
