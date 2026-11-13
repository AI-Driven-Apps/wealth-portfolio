import { requireCtx } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { fmtDateTime } from "@/lib/format";
import { Nav, type NavItem } from "./nav";
import { ScopeSwitcher } from "./scope-switcher";
import { Sidebar } from "./sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const f = ctx.features;
  const items: NavItem[] = [
    { href: "/", label: "Overview" },
    ...(f.has("mf") ? [{ href: "/mf", label: "Mutual funds", group: "Holdings" }] : []),
    ...(f.has("sip") ? [{ href: "/sip", label: "SIPs", group: "Holdings" }] : []),
    ...(f.has("fof") ? [{ href: "/fof", label: "Fund of funds", group: "Holdings" }] : []),
    ...(f.has("equity") ? [{ href: "/equity", label: "Stocks", group: "Holdings" }] : []),
    ...(f.has("etf") ? [{ href: "/etf", label: "ETFs", group: "Holdings" }] : []),
    ...(f.has("other") ? [{ href: "/fixed", label: "Fixed income & alts", group: "Holdings" }] : []),
    ...(f.has("loans") ? [{ href: "/loans", label: "Loans & EMIs", group: "Holdings" }] : []),
    ...(f.has("lookthrough") ? [{ href: "/lookthrough", label: "Look-through", group: "Analysis" }] : []),
    ...(f.has("fifty_two_week") ? [{ href: "/52-week", label: "52-week range", group: "Analysis" }] : []),
    ...(f.has("drift") ? [{ href: "/allocation", label: "Target allocation", group: "Analysis" }] : []),
    ...(f.has("what_if") ? [{ href: "/what-if", label: "What-if", group: "Analysis" }] : []),
    ...(f.has("ai_agents") && !config.isVercel ? [{ href: "/insights", label: "Market brief", group: "Analysis" }] : []),
    { href: "/transactions", label: "Transactions", group: "Data" },
    ...(f.has("imports") && config.importsEnabled ? [{ href: "/import", label: "Import", group: "Data" }] : []),
    ...(ctx.user.role === "admin" ? [
      { href: "/admin", label: "Users & profiles", group: "Admin" },
      { href: "/admin/features", label: "Features", group: "Admin" },
      { href: "/admin/data", label: "Data sources", group: "Admin" },
      { href: "/admin/disclosures", label: "Disclosures", group: "Admin" },
      { href: "/admin/jobs", label: "Jobs", group: "Admin" },
    ] : []),
    ...(ctx.user.role === "admin" || f.has("discord_user") ? [{ href: "/alerts", label: "Discord alerts", group: "You" }] : []),
    { href: "/account", label: "Account", group: "You" },
  ];

  const logoMark = <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M7 21l6-6 4 4 8-9" stroke="var(--accent-ink)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  const initials = ctx.user.name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen md:flex">
      <Sidebar
        mark={logoMark}
        nav={<Nav items={items} />}
        top={
          <>
            <div className="flex items-center gap-2 px-4 pt-4 pb-3">
              {logoMark}
              <span className="font-semibold">Wealth Portfolio</span>
            </div>
            <div className="px-3 pb-3">
              <ScopeSwitcher scope={ctx.scope} profiles={ctx.profiles} household={ctx.user.role === "admin" && ctx.profiles.length > 1} />
            </div>
          </>
        }
        bottom={
          <div className="hidden border-t border-line px-3 py-3 md:block">
            <div className="flex items-center gap-2.5 rounded-lg bg-panel-2 px-2.5 py-2">
              <a href={`${config.basePath}/account`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-ink">{initials}</a>
              <a href={`${config.basePath}/account`} className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{ctx.user.name}</div>
                <div className="truncate text-[11px] text-ink-3 capitalize">{ctx.user.role}</div>
              </a>
              <form action={`${config.basePath}/api/auth/logout`} method="post">
                <button aria-label="Sign out" title="Sign out" className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-panel hover:text-ink">
                  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden><path d="M6 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.3 8H6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </form>
            </div>
            <div className="mt-2 truncate px-0.5 text-[11px] text-ink-3" title={config.buildTime}>
              Build {config.buildSha || "unknown"} · {fmtDateTime(config.buildTime)}
            </div>
          </div>
        }
      />
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7">
        {config.isSample && (
          <div className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">Sample data: every fund, stock and price here is fictional.</div>
        )}
        {ctx.user.mustChangePassword && (
          <div className="mb-4 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
            You're using a temporary password. <a className="font-semibold underline" href={`${config.basePath}/account`}>Change it now</a>.
          </div>
        )}
        <div className="mx-auto max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
