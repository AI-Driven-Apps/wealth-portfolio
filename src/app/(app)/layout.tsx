import { requireCtx } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { Nav, type NavItem } from "./nav";
import { ScopeSwitcher } from "./scope-switcher";

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
    ...(f.has("drift") ? [{ href: "/allocation", label: "Target allocation", group: "Analysis" }] : []),
    ...(f.has("what_if") ? [{ href: "/what-if", label: "What-if", group: "Analysis" }] : []),
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

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-panel md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M7 21l6-6 4 4 8-9" stroke="var(--accent-ink)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="font-semibold">Wealth Portfolio</span>
        </div>
        <div className="px-3 pb-3">
          <ScopeSwitcher scope={ctx.scope} profiles={ctx.profiles} household={ctx.user.role === "admin" && ctx.profiles.length > 1} />
        </div>
        <div className="px-2 pb-3 md:flex-1 md:overflow-y-auto">
          <Nav items={items} />
        </div>
        <div className="hidden border-t border-line px-4 py-3 md:block">
          <a href={`${config.basePath}/account`} className="block truncate text-[13px] font-medium">{ctx.user.name}</a>
          <div className="truncate text-[12px] text-ink-3">{ctx.user.email}</div>
          <form action={`${config.basePath}/api/auth/logout`} method="post" className="mt-2">
            <button className="text-[12px] text-ink-2 underline-offset-2 hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
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
