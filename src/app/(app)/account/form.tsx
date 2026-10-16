"use client";
import { useActionState } from "react";
import { changePassword } from "../actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="max-w-sm space-y-3">
      <div className="flex flex-col gap-1"><label htmlFor="cur">Current password</label><input id="cur" name="current" type="password" autoComplete="current-password" required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="new">New password</label><input id="new" name="next" type="password" autoComplete="new-password" minLength={10} required /></div>
      <div className="flex flex-col gap-1"><label htmlFor="conf">Confirm new password</label><input id="conf" name="confirm" type="password" autoComplete="new-password" required /></div>
      {state?.error && <p className="text-[13px] text-loss">{state.error}</p>}
      <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{pending ? "Saving…" : "Change password"}</button>
      <p className="text-[12px] text-ink-3">At least 10 characters with a number. You'll be signed out everywhere and asked to sign in again.</p>
    </form>
  );
}
