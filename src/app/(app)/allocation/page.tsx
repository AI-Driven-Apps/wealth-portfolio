import clsx from "clsx";
import { requireCtx } from "@/lib/auth/session";
import { consolidated } from "@/lib/portfolio/consolidated";
import { getTargets, TARGET_CLASSES } from "@/lib/portfolio/allocation";
import { computeDrift, type DriftRow } from "@/lib/calc/drift";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, Notice, Badge, ASSET_COLORS, classLabel } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { compact, money } from "@/lib/format";
import { saveTargets } from "./actions";

export const metadata = { title: "Target allocation" };

/** Current vs target on one 0–100% track per class, with the band shaded around the target. */
function DriftTable({ rows }: { rows: DriftRow[] }) {
  return (
    <div className="overflow-x-auto"><table>
      <thead><tr><th>Asset class</th><th className="w-[40%]">Current vs target</th><th className="r">Current</th><th className="r">Target</th><th className="r">Drift</th><th className="r">To get back to target</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.assetClass}>
          <td><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: ASSET_COLORS[r.assetClass] ?? "var(--c8)" }} />{classLabel(r.assetClass)}</span></td>
          <td>
            <div className="relative h-3 rounded-full bg-panel-2" role="img" aria-label={`${classLabel(r.assetClass)}: ${r.currentPct.toFixed(1)}% now, target ${r.targetPct}% ± ${r.band}`}>
              {r.targeted && <div className="absolute inset-y-0 rounded-full bg-accent-soft" style={{ left: `${Math.max(r.targetPct - r.band, 0)}%`, width: `${Math.min(r.targetPct + r.band, 100) - Math.max(r.targetPct - r.band, 0)}%` }} />}
              {r.targeted && <div className="absolute inset-y-[-3px] w-0.5 bg-ink-2" style={{ left: `${r.targetPct}%` }} />}
              <div className={clsx("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel", r.breached ? "bg-loss" : "bg-accent")} style={{ left: `${Math.min(r.currentPct, 100)}%` }} />
            </div>
          </td>
          <td className="r num">{r.currentPct.toFixed(1)}%<div className="text-[11px] text-ink-3">{compact(r.value)}</div></td>
          <td className="r num">{r.targeted ? `${r.targetPct}% ± ${r.band}` : <span className="text-ink-3">none</span>}</td>
          <td className={clsx("r num", r.breached && "font-semibold text-loss")}>{r.diff > 0 ? "+" : ""}{r.diff.toFixed(1)} pts{r.breached && <div className="text-[11px] font-normal">outside band</div>}</td>
          <td className="r num">{Math.abs(r.toTarget) < 1 ? "—" : `${r.toTarget > 0 ? "Add" : "Trim"} ${money(Math.abs(r.toTarget))}`}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default async function AllocationPage() {
  const ctx = await requireCtx("drift");
  const band = await getSetting("drift_default_band");
  const household = ctx.scope === "household";
  const profiles = household ? ctx.profiles : ctx.profiles.filter((p) => p.id === ctx.scope);
  const views = await Promise.all(profiles.map(async (p) => {
    const c = await consolidated({ profileIds: [p.id], features: ctx.features });
    const targets = await getTargets(p.id, band);
    return { p, c, targets, rows: computeDrift(c.classes, targets, band) };
  }));
  const own = !household ? views[0] : null;
  const canEdit = !household && ctx.canManage;

  return (
    <>
      <PageHeader title="Target allocation" sub={`Set the mix you want (e.g. 60/25/15 equity/debt/gold). A class more than its band away from target is flagged here, on the Overview and in Discord drift alerts. Default band: ±${band} points.`} />
      {views.map((v) => (
        <Card key={v.p.id} className="mb-4" pad={false} title={household ? v.p.name : "Current vs target"}
          actions={v.rows.some((r) => r.breached) ? <Badge kind="loss">{v.rows.filter((r) => r.breached).length} outside band</Badge> : v.targets.length ? <Badge kind="accent">within bands</Badge> : <Badge>no targets</Badge>}>
          {v.c.assets > 0 ? <DriftTable rows={v.rows} /> : <p className="px-4 py-4 text-ink-3">No assets yet.</p>}
          <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">Classes are the holding's own class (a hybrid fund counts as hybrid; gold ETFs as gold), plus fixed income and alternatives. Real estate is left out unless you give it a target.</p>
        </Card>
      ))}
      {household && <Notice kind="info">Switch to a single profile to set its targets.</Notice>}
      {own && (
        <Card title="Targets">
          {!canEdit ? <Notice kind="info">You have view-only access to this profile.</Notice> : (
            <ActionForm action={saveTargets} submit="Save targets" className="space-y-3">
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {TARGET_CLASSES.map((c) => {
                  const t = own.targets.find((x) => x.assetClass === c);
                  return (
                    <div key={c} className="grid grid-cols-[1fr_88px_88px] items-center gap-2">
                      <span className="text-[13px]">{classLabel(c)}</span>
                      <input name={`t_${c}`} type="number" min="0" max="100" step="any" defaultValue={t?.targetPct ?? ""} placeholder="target %" aria-label={`${classLabel(c)} target %`} />
                      <input name={`b_${c}`} type="number" min="0.5" max="50" step="any" defaultValue={t && t.bandPct !== band ? t.bandPct : ""} placeholder={`± ${band}`} aria-label={`${classLabel(c)} band`} />
                    </div>
                  );
                })}
              </div>
              <p className="text-[12px] text-ink-3">Targets must add up to 100%. Leave a class blank to not target it (it then counts as 0% target). Leave the band blank to use the default.</p>
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
