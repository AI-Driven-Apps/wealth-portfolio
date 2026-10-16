"use client";
import { useRef } from "react";
import { setScope } from "./actions";

export function ScopeSwitcher({ scope, profiles, household }: { scope: string; profiles: { id: string; name: string }[]; household: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  if (profiles.length <= 1 && !household) {
    return <div className="truncate text-[13px] font-medium">{profiles[0]?.name ?? "No profile assigned"}</div>;
  }
  return (
    <form ref={ref} action={setScope} key={scope}>
      <label htmlFor="scope" className="sr-only">Portfolio</label>
      <select id="scope" name="scope" defaultValue={scope} onChange={() => ref.current?.requestSubmit()} className="w-full text-[13px] font-medium">
        {household && <option value="household">Household (all profiles)</option>}
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </form>
  );
}
