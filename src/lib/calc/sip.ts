export interface SipPlanInput {
  amount: number;
  dayOfMonth: number;   // 1–28 recommended; 29–31 clamp to month end
  stepUpPct: number;    // yearly step-up, e.g. 10 for 10%
  startDate: string;    // yyyy-mm-dd
  endDate: string | null;
}

export interface Instalment { due: string; amount: number }

export interface InstalmentStatus extends Instalment {
  status: "paid" | "missed" | "upcoming";
  matchedDate?: string;
  matchedAmount?: number;
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** All due dates from start up to and including `until`, with yearly step-up applied. */
export function expectedInstalments(plan: SipPlanInput, until: string): Instalment[] {
  const out: Instalment[] = [];
  const [sy, sm, sd] = plan.startDate.split("-").map(Number);
  let y = sy, m = sm;
  if (sd > plan.dayOfMonth) { m++; if (m > 12) { m = 1; y++; } }
  const stop = plan.endDate && plan.endDate < until ? plan.endDate : until;
  for (let i = 0; i < 1200; i++) {
    const due = iso(y, m, Math.min(plan.dayOfMonth, lastDay(y, m)));
    if (due > stop) break;
    const years = Math.floor(i / 12);
    const amount = Math.round(plan.amount * Math.pow(1 + plan.stepUpPct / 100, years) * 100) / 100;
    out.push({ due, amount });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(d + "T00:00:00Z");

/**
 * Match expected instalments to actual purchases (one-to-one, nearest date within ±toleranceDays,
 * amount within ±5% to allow for stamp duty). Unmatched past dues are "missed".
 */
export function matchInstalments(
  expected: Instalment[],
  purchases: { date: string; amount: number }[],
  today: string,
  toleranceDays = 7,
): InstalmentStatus[] {
  const used = new Set<number>();
  return expected.map((e) => {
    let best = -1, bestGap = Infinity;
    purchases.forEach((p, i) => {
      if (used.has(i)) return;
      const gap = Math.abs(t(p.date) - t(e.due)) / DAY;
      const amtOk = Math.abs(p.amount - e.amount) <= Math.max(e.amount * 0.05, 1);
      if (gap <= toleranceDays && amtOk && gap < bestGap) { best = i; bestGap = gap; }
    });
    if (best >= 0) {
      used.add(best);
      return { ...e, status: "paid" as const, matchedDate: purchases[best].date, matchedAmount: purchases[best].amount };
    }
    const graceOver = t(e.due) + toleranceDays * DAY < t(today);
    return { ...e, status: graceOver ? ("missed" as const) : ("upcoming" as const) };
  });
}

export function nextDue(plan: SipPlanInput, today: string): string | null {
  const [y, m] = today.split("-").map(Number);
  const horizon = iso(y + 1, m, 28);
  const all = expectedInstalments(plan, horizon);
  return all.find((i) => i.due >= today)?.due ?? null;
}
