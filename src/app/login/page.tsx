import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCtx()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M7 21l6-6 4 4 8-9" stroke="var(--accent-ink)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="text-[17px] font-semibold">Wealth Portfolio</span>
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <LoginForm next={next ?? "/"} />
        </div>
        {config.isSample && (
          <p className="mt-4 text-[13px] text-ink-2">
            Sample-data demo. Sign in as <b>admin@sample.local</b> (admin) or <b>meera@sample.local</b> (member){process.env.SHOW_SAMPLE_PASSWORD === "1" ? <> with password <b>{process.env.SAMPLE_PASSWORD ?? "sample-portfolio-2026"}</b></> : null}. All funds, stocks and prices are fictional.
          </p>
        )}
      </div>
    </main>
  );
}
