import { desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { JOBS, jobBlocked } from "@/lib/jobs";
import { config } from "@/lib/config";
import { PageHeader, Card, Badge, btnGhost } from "@/components/ui";
import { runJobNow } from "../actions";

export const metadata = { title: "Jobs" };

const VERCEL_DAILY = "in the daily run, 00:00 IST (production only)";
const SCHEDULE: Record<string, string> = !config.isVercel
  ? { "scheme-master": "daily 23:45 IST", "nav-history": "daily 00:30 IST", prices: "weekdays 18:30 IST", "live-quotes": "every 5 min, 09:15–15:30 weekdays", "dhan-scrip-master": "daily 08:30 IST", "nse-equity-list": "Sundays 07:00 IST", alerts: "daily 08:00 IST", "ai-brief": "weekdays 19:15 IST", daily: "manual (the worker schedules each job itself)" }
  : config.isSample
    ? { "sample-extend": "at every build (previews don't run Vercel Cron)" }
    : { daily: "Vercel Cron, 00:00 IST", "scheme-master": VERCEL_DAILY, "nav-history": VERCEL_DAILY, prices: VERCEL_DAILY, alerts: VERCEL_DAILY, "nse-equity-list": "in the daily run on Sundays" };

const when = (d: Date | null) => d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function JobsPage() {
  await requireAdmin();
  const runs = await db.select().from(schema.jobRun).orderBy(desc(schema.jobRun.startedAt)).limit(60);
  const last = (job: string) => runs.find((r) => r.job === job);
  const names = Object.keys(JOBS).filter((n) => !jobBlocked(n));
  return (
    <>
      <PageHeader title="Jobs" sub={config.isSample ? "Sample data: only the demo job runs." : config.isVercel ? "One Vercel Cron runs the daily sequence; you can run any step by hand. Every job is safe to re-run." : "Scheduled by the worker container. Every job is safe to re-run."} />
      <Card pad={false}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th>Result</th><th /></tr></thead>
          <tbody>{names.map((n) => {
            const r = last(n);
            return (
              <tr key={n}>
                <td><div className="font-medium">{n}</div><div className="text-[12px] text-ink-3">{JOBS[n].label}</div></td>
                <td className="text-ink-2">{SCHEDULE[n] ?? "manual"}</td>
                <td className="whitespace-nowrap text-ink-2">{when(r?.startedAt ?? null)}</td>
                <td className="max-w-[360px]">{r ? <><Badge kind={r.status === "ok" ? "accent" : r.status === "error" ? "loss" : "neutral"}>{r.status}</Badge> <span className="text-[12px] text-ink-3 break-words">{JSON.stringify(r.detail)?.slice(0, 160)}</span></> : "—"}</td>
                <td className="r"><form action={runJobNow}><input type="hidden" name="job" value={n} /><button className={btnGhost}>Run now</button></form></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>
      <Card title="Recent runs" className="mt-4" pad={false}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>Job</th><th>Started</th><th>Took</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>{runs.slice(0, 30).map((r) => (
            <tr key={r.id}>
              <td>{r.job}</td><td className="whitespace-nowrap text-ink-2">{when(r.startedAt)}</td>
              <td className="num text-ink-2">{r.finishedAt ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)} s` : "running"}</td>
              <td><Badge kind={r.status === "ok" ? "accent" : r.status === "error" ? "loss" : "neutral"}>{r.status}</Badge></td>
              <td className="max-w-[420px] truncate text-[12px] text-ink-3" title={JSON.stringify(r.detail)}>{JSON.stringify(r.detail)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  );
}
