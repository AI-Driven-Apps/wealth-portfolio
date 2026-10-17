// Target allocation vs actual, in percentage points of the total.

export interface Target { assetClass: string; targetPct: number; bandPct: number }

export interface DriftRow {
  assetClass: string;
  value: number;
  currentPct: number;
  targetPct: number;
  /** current − target, in percentage points. */
  diff: number;
  band: number;
  breached: boolean;
  /** Rupees to add (+) or take out (−) to land exactly on target. */
  toTarget: number;
  targeted: boolean;
}

/** A home you live in isn't part of the investment mix unless you give it a target. */
export const OUTSIDE_ALLOCATION = new Set(["real_estate"]);

/** Classes with no target count as target 0%, so money drifting into them is visible. */
export function computeDrift(all: Map<string, number>, targets: Target[], defaultBand: number): DriftRow[] {
  const targeted = new Set(targets.map((t) => t.assetClass));
  const current = new Map([...all].filter(([k]) => targeted.has(k) || !OUTSIDE_ALLOCATION.has(k)));
  const total = [...current.values()].reduce((s, v) => s + Math.max(v, 0), 0);
  const classes = new Set([...targeted, ...[...current.entries()].filter(([, v]) => v > 0).map(([k]) => k)]);
  const rows: DriftRow[] = [];
  for (const c of classes) {
    const t = targets.find((x) => x.assetClass === c);
    const value = Math.max(current.get(c) ?? 0, 0);
    const currentPct = total ? (value / total) * 100 : 0;
    const targetPct = t?.targetPct ?? 0;
    const band = t?.bandPct ?? defaultBand;
    const diff = currentPct - targetPct;
    rows.push({
      assetClass: c, value, currentPct, targetPct, diff, band,
      breached: total > 0 && Math.abs(diff) > band + 1e-9,
      toTarget: (targetPct / 100) * total - value,
      targeted: !!t,
    });
  }
  return rows.sort((a, b) => b.targetPct - a.targetPct || b.value - a.value);
}

export function targetsProblem(targets: { assetClass: string; targetPct: number }[]): string | null {
  if (!targets.length) return null;
  if (targets.some((t) => t.targetPct < 0 || t.targetPct > 100)) return "Each target must be between 0 and 100%.";
  const sum = targets.reduce((s, t) => s + t.targetPct, 0);
  if (Math.abs(sum - 100) > 0.01) return `Targets add up to ${sum.toFixed(1)}%; they must total 100%.`;
  return null;
}
