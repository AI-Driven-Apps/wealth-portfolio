"use client";
import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      {state?.error && <p className="text-[13px] text-loss">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
