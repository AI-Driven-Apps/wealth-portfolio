"use server";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/auth/session";
import { aiBlocked, manualRunAllowed, runBrief } from "@/lib/agents/brief";
import { audit } from "@/lib/audit";

export async function generateBrief(): Promise<{ error: string } | { ok: string } | null> {
  const ctx = await requireCtx("ai_agents");
  const why = aiBlocked() ?? (await manualRunAllowed(ctx.user.id));
  if (why) return { error: why };
  await audit(ctx.user.id, "ai.brief", { trigger: "manual" });
  const r = await runBrief(ctx.user.id, "manual");
  revalidatePath("/insights");
  return r.status === "ok" ? { ok: r.error ? `Written. ${r.error}` : "Written." } : { error: r.error ?? "The brief failed." };
}
