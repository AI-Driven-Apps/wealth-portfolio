// Pi-only scheduler. Runs the same job functions Vercel Cron calls over HTTP.
// Times are IST. Each job logs to job_run and is safe to re-run, so a missed
// night (Pi rebooted, network down) is simply caught up on the next run.
import cron from "node-cron";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { runJob } from "../src/lib/jobs";
import { config } from "../src/lib/config";

const TZ = "Asia/Kolkata";
const running = new Set<string>();

async function run(name: string) {
  if (running.has(name)) return; // never overlap the same job
  running.add(name);
  const t0 = Date.now();
  try {
    const r = await runJob(name);
    console.log(`[${new Date().toISOString()}] ${name} ${r.status} in ${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(r.detail).slice(0, 300));
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ${name} failed:`, (e as Error).message);
  } finally {
    running.delete(name);
  }
}

const SCHEDULE: [string, string][] = [
  ["45 23 * * *", "scheme-master"],     // AMFI publishes NAVAll by ~11 pm IST
  ["30 0 * * *", "nav-history"],         // fill any gaps from mfapi.in
  ["30 18 * * 1-5", "prices"],           // after NSE close + Yahoo settle
  ["*/5 9-15 * * 1-5", "live-quotes"],   // Dhan LTP during market hours
  ["30 8 * * 1-5", "dhan-scrip-master"], // Dhan republishes each morning
  ["0 7 * * 0", "nse-equity-list"],      // weekly is plenty
];

async function main() {
  if (config.isVercel) { console.log("worker is not used on Vercel"); return; }
  for (const [expr, name] of SCHEDULE) cron.schedule(expr, () => void run(name), { timezone: TZ });
  console.log(`worker started: ${SCHEDULE.map(([e, n]) => `${n} @ ${e}`).join(", ")}`);

  // First boot: an empty instrument master means search won't find funds yet.
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from instrument where type = 'mf'`);
  if (Number(n) < 100) {
    console.log("instrument master is empty: loading AMFI scheme list now");
    await run("scheme-master");
    await run("nse-equity-list");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
process.on("SIGTERM", () => process.exit(0));
