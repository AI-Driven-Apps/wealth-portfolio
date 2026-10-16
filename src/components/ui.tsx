import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { pct, compact, tone } from "@/lib/format";

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx("rounded-xl border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={clsx(pad && "p-4")}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, subTone }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: number | null }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num mt-1 text-[20px] font-semibold tracking-tight">{value}</div>
      {sub !== undefined && <div className={clsx("num mt-0.5 text-[12px]", subTone !== undefined ? tone(subTone) : "text-ink-2")}>{sub}</div>}
    </div>
  );
}

export function Badge({ children, kind = "neutral", title }: { children: ReactNode; kind?: "neutral" | "warn" | "accent" | "loss"; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
      kind === "neutral" && "bg-panel-2 text-ink-2 ring-1 ring-line",
      kind === "warn" && "bg-warn-soft text-warn",
      kind === "accent" && "bg-accent-soft text-accent",
      kind === "loss" && "bg-warn-soft text-loss")}>{children}</span>
  );
}

export function Delta({ v, children }: { v: number | null | undefined; children?: ReactNode }) {
  return <span className={clsx("num", tone(v))}>{children ?? pct(v, 1, true)}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel px-6 py-10 text-center">
      <div className="font-semibold">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-ink-2">{children}</div>}
    </div>
  );
}

export function Notice({ children, kind = "warn" }: { children: ReactNode; kind?: "warn" | "info" }) {
  return (
    <div className={clsx("rounded-lg px-3 py-2 text-[13px]", kind === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent")}>{children}</div>
  );
}

export const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50";
export const btnPrimary = clsx(btn, "bg-accent text-accent-ink hover:opacity-90");
export const btnGhost = clsx(btn, "border border-line bg-panel hover:bg-panel-2");
export const btnDanger = clsx(btn, "border border-line bg-panel text-loss hover:bg-panel-2");

export function LinkButton({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return <Link href={href} className={primary ? btnPrimary : btnGhost}>{children}</Link>;
}

const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)", "var(--c8)"];

/** One stacked bar + legend: easier to compare shares than a pie. */
export function AllocationBar({ parts, colorFor }: { parts: { name: string; value: number; pct: number }[]; colorFor?: (name: string, i: number) => string }) {
  if (!parts.length) return <div className="text-ink-3">Nothing to show yet.</div>;
  const col = (n: string, i: number) => colorFor?.(n, i) ?? COLORS[i % COLORS.length];
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-panel-2" role="img" aria-label={parts.map((p) => `${p.name} ${pct(p.pct, 0)}`).join(", ")}>
        {parts.map((p, i) => (
          <div key={p.name} style={{ width: `${p.pct * 100}%`, background: col(p.name, i) }} className="h-full border-r border-panel last:border-0" title={`${p.name}: ${pct(p.pct)}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {parts.map((p, i) => (
          <li key={p.name} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: col(p.name, i) }} />
            <span className="truncate">{p.name.charAt(0).toUpperCase() + p.name.slice(1)}</span>
            <span className="num ml-auto text-ink-2">{compact(p.value)}</span>
            <span className="num w-12 text-right font-medium">{pct(p.pct, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const ASSET_COLORS: Record<string, string> = {
  equity: "var(--c1)", debt: "var(--c3)", hybrid: "var(--c7)", gold: "var(--c2)", silver: "var(--c8)",
  international: "var(--c6)", other: "var(--c8)", Unclassified: "var(--c8)",
};
export const CAP_COLORS: Record<string, string> = { large: "var(--c1)", mid: "var(--c5)", small: "var(--c2)", Unclassified: "var(--c8)" };
