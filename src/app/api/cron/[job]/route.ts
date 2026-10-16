import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runJob, JOBS } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET". The Pi worker calls jobs directly, not via HTTP.
function authorised(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return secret.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const { job } = await params;
  if (!JOBS[job]) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  try {
    return NextResponse.json(await runJob(job));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
