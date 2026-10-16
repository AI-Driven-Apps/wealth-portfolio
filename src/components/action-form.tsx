"use client";
import { useActionState, type ReactNode } from "react";
import clsx from "clsx";

type R = { error: string } | { ok: string } | null;

/** Small wrapper so server components can render forms that show an action's result. */
export function ActionForm({ action, children, submit, className, ghost }: {
  action: (prev: R, fd: FormData) => Promise<R>; children?: ReactNode; submit: string; className?: string; ghost?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={clsx("rounded-lg px-3 py-1.5 text-[13px] font-medium disabled:opacity-50", ghost ? "border border-line bg-panel hover:bg-panel-2" : "bg-accent text-accent-ink")}>{pending ? "Working…" : submit}</button>
        {state && "error" in state && <span className="text-[13px] text-loss">{state.error}</span>}
        {state && "ok" in state && <span className="text-[13px] font-medium text-gain select-all">{state.ok}</span>}
      </div>
    </form>
  );
}
