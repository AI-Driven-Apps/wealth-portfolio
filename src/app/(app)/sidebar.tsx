"use client";
import { cloneElement, useEffect, useState, type ReactElement } from "react";
import clsx from "clsx";

const KEY = "wp_sidebar_collapsed";

export function Sidebar({ mark, top, nav, bottom }: {
  mark: React.ReactNode;
  top: React.ReactNode;
  nav: ReactElement<{ collapsed?: boolean }>;
  bottom: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { if (localStorage.getItem(KEY) === "1") setCollapsed(true); }, []);
  const toggle = () => setCollapsed((c) => { localStorage.setItem(KEY, c ? "0" : "1"); return !c; });
  return (
    <div className="relative md:shrink-0">
      <aside className={clsx("border-b border-line bg-panel transition-[width] md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r md:border-b-0", collapsed ? "md:w-16" : "md:w-56")}>
        {collapsed ? (
          <div className="hidden md:flex md:flex-1 md:flex-col md:items-center md:gap-3 md:overflow-y-auto md:pt-4">
            {mark}
            {cloneElement(nav, { collapsed: true })}
          </div>
        ) : (
          <>
            {top}
            <div className="px-2 pb-3 md:flex-1 md:overflow-y-auto">{nav}</div>
            {bottom}
          </>
        )}
      </aside>
      <button type="button" onClick={toggle} aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        className="absolute top-4 -right-3 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-line bg-panel text-ink-2 shadow-sm hover:text-ink md:flex">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d={collapsed ? "M3 1l4 4-4 4" : "M7 1L3 5l4 4"} stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
