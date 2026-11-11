"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export interface NavItem { href: string; label: string; group?: string }

export function Nav({ items }: { items: NavItem[] }) {
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
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Main">
      {items.map((it) => {
        const header = it.group && it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        const open = !it.group || !closed.has(it.group);
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
                className={clsx("shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] whitespace-nowrap",
                  active(it.href) ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}>
                {it.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
