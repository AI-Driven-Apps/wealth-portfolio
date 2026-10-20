import { and, desc, eq } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { aiBlocked, BRIEF_KIND } from "@/lib/agents/brief";
import { PageHeader, Card, Notice, Badge } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { fmtDate } from "@/lib/format";
import { Markdown } from "./markdown";
import { generateBrief } from "./actions";

export const metadata = { title: "Market brief" };
export const dynamic = "force-dynamic";

const when = (d: Date) => `${fmtDate(d.toISOString())} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`;

export default async function InsightsPage() {
  const ctx = await requireCtx("ai_agents");
  const blocked = aiBlocked();
  const runs = await db.select().from(schema.agentReport)
    .where(and(eq(schema.agentReport.userId, ctx.user.id), eq(schema.agentReport.kind, BRIEF_KIND)))
    .orderBy(desc(schema.agentReport.startedAt)).limit(20);
  const latest = runs.find((r) => r.status === "ok");

  return (
    <>
      <PageHeader title="Market brief" sub={<>Written by Claude from your holdings{config.aiWebSearch ? " and news on the largest ones" : ""}, weekdays after the 18:30 price update. Read-only: it can&apos;t change or trade anything.</>} />
      {blocked && <div className="mb-4"><Notice>{blocked}</Notice></div>}
      {!blocked && (
        <div className="mb-4">
          <ActionForm action={generateBrief} submit="Write a brief now" ghost />
          <p className="mt-1 text-[12px] text-ink-3">Takes a minute or two. Up to {config.aiDailyLimit} a day besides the scheduled one. Your holdings (names, amounts, returns) are sent to the Claude API for this; folio and account numbers are not.</p>
        </div>
      )}
      <Card title={latest ? `${latest.scopeLabel ?? "Brief"} · ${when(latest.startedAt)}` : "Latest brief"}>
        {latest?.body ? <Markdown text={latest.body} /> : <p className="text-ink-3">No brief yet.</p>}
      </Card>
      {runs.length > 0 && (
        <Card title="Runs" className="mt-6" pad={false}>
          <div className="overflow-x-auto"><table>
            <thead><tr><th>When</th><th>How</th><th>Status</th><th className="r">Tokens in / out</th><th className="r">Web searches</th><th>Note</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{when(r.startedAt)}</td>
                <td>{r.trigger === "manual" ? "You" : "Scheduled"}</td>
                <td><Badge kind={r.status === "ok" ? "accent" : r.status === "error" ? "loss" : "neutral"}>{r.status}</Badge></td>
                <td className="r num">{r.usage ? `${(r.usage.input_tokens ?? 0).toLocaleString("en-IN")} / ${(r.usage.output_tokens ?? 0).toLocaleString("en-IN")}` : "—"}</td>
                <td className="r num">{r.usage?.web_searches ?? "—"}</td>
                <td className="max-w-[360px] text-[12px] text-ink-2">{r.error}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}
