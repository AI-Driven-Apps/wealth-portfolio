"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export interface NavItem { href: string; label: string; group?: string }

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
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
        return (
          <div key={it.href} className="contents">
            {header && <div className="mt-4 hidden px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase md:block">{header}</div>}
            <Link href={it.href} aria-current={active(it.href) ? "page" : undefined}
              className={clsx("shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] whitespace-nowrap",
                active(it.href) ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}>
              {it.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
