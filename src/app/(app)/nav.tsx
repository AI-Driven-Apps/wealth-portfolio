"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  LayoutDashboard, PiggyBank, Repeat, Layers, TrendingUp, BarChart3, Landmark, HandCoins,
  ScanSearch, CalendarRange, PieChart, FlaskConical, Sparkles, Receipt, Upload, Users,
  ToggleLeft, Database, FileText, ListChecks, Bell, Settings, Circle, type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; group?: string }

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/mf": PiggyBank,
  "/sip": Repeat,
  "/fof": Layers,
  "/equity": TrendingUp,
  "/etf": BarChart3,
  "/fixed": Landmark,
  "/loans": HandCoins,
  "/lookthrough": ScanSearch,
  "/52-week": CalendarRange,
  "/allocation": PieChart,
  "/what-if": FlaskConical,
  "/insights": Sparkles,
  "/transactions": Receipt,
  "/import": Upload,
  "/admin": Users,
  "/admin/features": ToggleLeft,
  "/admin/data": Database,
  "/admin/disclosures": FileText,
  "/admin/jobs": ListChecks,
  "/alerts": Bell,
  "/account": Settings,
};

export function Nav({ items, collapsed }: { items: NavItem[]; collapsed?: boolean }) {
  const path = usePathname();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggleGroup = (g: string) => setClosed((s) => {
    const next = new Set(s);
    next.has(g) ? next.delete(g) : next.add(g);
    return next;
  });
  // The longest matching item wins, so /admin/features doesn't also light up /admin.
  const matches = items.filter((it) => (it.href === "/" ? path === "/" : path === it.href || path.startsWith(it.href + "/")));
  const best = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const active = (href: string) => href === best;
  let lastGroup: string | undefined;
  return (
    <nav className={clsx("flex gap-1 overflow-x-auto md:flex-col md:overflow-visible", collapsed && "md:items-center")} aria-label="Main">
      {items.map((it) => {
        const header = !collapsed && it.group && it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        const open = collapsed || !it.group || !closed.has(it.group);
        const Icon = ICONS[it.href] ?? Circle;
        return (
          <div key={it.href} className="contents">
            {header && (
              <button type="button" onClick={() => toggleGroup(header)} aria-expanded={!closed.has(header)}
                className="mt-4 hidden w-full items-center justify-between px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase hover:text-ink-2 md:flex">
                {header}
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className={clsx("transition-transform", closed.has(header) && "-rotate-90")}>
                  <path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {open && (
              <Link href={it.href} aria-current={active(it.href) ? "page" : undefined}
                title={collapsed ? it.label : undefined} aria-label={collapsed ? it.label : undefined}
                className={clsx("flex shrink-0 items-center gap-2 rounded-lg text-[13px] whitespace-nowrap",
                  collapsed ? "h-9 w-9 justify-center" : "px-2.5 py-1.5",
                  active(it.href) ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}>
                <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0" />
                {!collapsed && it.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
