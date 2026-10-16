import { asc, eq } from "drizzle-orm";
import clsx from "clsx";
import { requireAdmin } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { config } from "@/lib/config";
import { PageHeader, Card, Badge } from "@/components/ui";
import { setGlobalFeature, setUserFeature } from "../actions";

export const metadata = { title: "Features" };

export default async function FeaturesPage() {
  await requireAdmin();
  const flags = await db.select().from(schema.featureFlag);
  const members = await db.select().from(schema.appUser).where(eq(schema.appUser.role, "member")).orderBy(asc(schema.appUser.name));
  const grants = await db.select().from(schema.userFeature);
  const on = (k: string) => flags.find((f) => f.key === k)?.enabled ?? false;
  const granted = (u: string, k: string) => grants.some((g) => g.userId === u && g.key === k && g.enabled);

  return (
    <>
      <PageHeader title="Features" sub="A module shows for a member only when it is on for everyone here AND ticked for that member. Admins see every module that's on." />
      <Card pad={false}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>Module</th><th>Everyone</th>{members.map((m) => <th key={m.id} className="text-center">{m.name}</th>)}</tr></thead>
          <tbody>{FEATURES.map((f) => {
            const key: string = f.key;
            const blocked = !f.built || (key === "ai_agents" && config.isVercel) || (key === "imports" && !config.importsEnabled);
            return (
              <tr key={f.key}>
                <td><div className="font-medium">{f.label}</div><div className="text-[12px] text-ink-3">{!f.built ? <Badge>Phase {f.phase}</Badge> : blocked ? "Not available on this deployment" : `Phase ${f.phase}`}</div></td>
                <td>
                  <form action={setGlobalFeature}><input type="hidden" name="key" value={f.key} /><input type="hidden" name="enabled" value={on(f.key) ? "false" : "true"} />
                    <button disabled={blocked} className={clsx("rounded-full px-3 py-1 text-[12px] font-medium disabled:opacity-40", on(f.key) ? "bg-accent text-accent-ink" : "border border-line text-ink-2")}>{on(f.key) ? "On" : "Off"}</button>
                  </form>
                </td>
                {members.map((m) => (
                  <td key={m.id} className="text-center">
                    <form action={setUserFeature}><input type="hidden" name="userId" value={m.id} /><input type="hidden" name="key" value={f.key} /><input type="hidden" name="enabled" value={granted(m.id, f.key) ? "false" : "true"} />
                      <button disabled={blocked || !on(f.key)} aria-label={`${f.label} for ${m.name}`} aria-pressed={granted(m.id, f.key)}
                        className={clsx("h-6 w-6 rounded-md border text-[13px] disabled:opacity-30", granted(m.id, f.key) ? "border-accent bg-accent text-accent-ink" : "border-line")}>{granted(m.id, f.key) ? "✓" : ""}</button>
                    </form>
                  </td>
                ))}
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>
      {!members.length && <p className="mt-3 text-[13px] text-ink-3">No members yet. Add one under Users & profiles.</p>}
    </>
  );
}
