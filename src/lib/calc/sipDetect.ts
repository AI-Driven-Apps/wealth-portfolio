import { expectedInstalments, matchInstalments } from "./sip";
import { addDays } from "./dates";

// Finds a SIP in a fund's purchase history: one purchase a month on about the
// same day, for at least three months. The detected plan is then checked
// against the purchases with the same matcher the SIP page uses, so a
// suggestion is only made when it would actually line up with the ledger.

export interface Purchase { date: string; amount: number; type: string }

export interface DetectedSip {
  startDate: string;
  dayOfMonth: number;
  amount: number;
  stepUpPct: number;
  active: boolean;
  endDate: string | null;
  instalments: number;
  /** Share of the plan's expected instalments that match a purchase (0..1). */
  fit: number;
}

const day = (d: string) => Number(d.slice(8, 10));
const ym = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
const circ = (a: number, b: number) => Math.min(Math.abs(a - b), 31 - Math.abs(a - b));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function detectSip(purchases: Purchase[], today: string, minInstalments = 3): DetectedSip | null {
  const sips = purchases.filter((p) => p.type === "sip");
  const pool = (sips.length >= minInstalments ? sips : purchases.filter((p) => p.type === "sip" || p.type === "buy"))
    .filter((p) => p.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pool.length < minInstalments) return null;

  // The most common day of month (±3 days counts as the same day).
  let modeDay = day(pool[0].date), best = -1;
  for (let d = 1; d <= 31; d++) {
    const n = pool.filter((p) => circ(day(p.date), d) <= 3).length;
    if (n > best) { best = n; modeDay = d; }
  }
  // Ties (4 and 5 both cover a SIP on the 5th): settle on the median day inside the window.
  modeDay = Math.round(median(pool.filter((p) => circ(day(p.date), modeDay) <= 3).map((p) => day(p.date))));
  // One purchase per month: the one closest to that day.
  const byMonth = new Map<number, Purchase>();
  for (const p of pool) {
    if (circ(day(p.date), modeDay) > 4) continue;
    const k = ym(p.date), ex = byMonth.get(k);
    if (!ex || circ(day(p.date), modeDay) < circ(day(ex.date), modeDay)) byMonth.set(k, p);
  }
  // Longest run of months, allowing one missed month (a bounced SIP) at a time.
  const months = [...byMonth.keys()].sort((a, b) => a - b);
  let runStart = 0, bestRun: [number, number] = [0, -1];
  for (let i = 1; i <= months.length; i++) {
    if (i === months.length || months[i] - months[i - 1] > 2) {
      if (i - 1 - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, i - 1];
      runStart = i;
    }
  }
  const run = months.slice(bestRun[0], bestRun[1] + 1).map((m) => byMonth.get(m)!);
  if (run.length < minInstalments) return null;

  // Amount and yearly step-up.
  const first = run[0];
  const years: number[][] = [];
  for (const p of run) {
    const y = Math.floor((ym(p.date) - ym(first.date)) / 12);
    (years[y] ??= []).push(p.amount);
  }
  const medians = years.filter(Boolean).map(median);
  let amount = medians[0], stepUpPct = 0, startDate = first.date;
  const steps = medians.slice(1).map((m, i) => m / medians[i] - 1);
  const consistent = steps.length > 0 && steps.every((s) => s > 0.005) && Math.max(...steps) - Math.min(...steps) < 0.03;
  if (consistent) stepUpPct = Math.round((steps.reduce((a, b) => a + b, 0) / steps.length) * 200) / 2; // nearest 0.5%
  else if (medians.some((m) => Math.abs(m / amount - 1) > 0.05)) {
    // Irregular changes: describe the plan as it runs now.
    const latest = run[run.length - 1].amount;
    const since = [...run].reverse().findIndex((p) => Math.abs(p.amount / latest - 1) > 0.05);
    const from = since < 0 ? 0 : run.length - since;
    if (run.length - from < minInstalments) return null;
    amount = latest; startDate = run[from].date;
  }

  const last = run[run.length - 1].date;
  const active = last >= addDays(today, -40);
  // From the 1st of the first month, so that month's instalment is due on the SIP day.
  const plan = { amount, dayOfMonth: modeDay, stepUpPct, startDate: startDate.slice(0, 8) + "01", endDate: active ? null : last };
  // Self-check with the SIP page's matcher.
  const expected = expectedInstalments(plan, active ? today : last).filter((e) => e.due <= addDays(today, -8));
  const matched = matchInstalments(expected, pool.map((p) => ({ date: p.date, amount: p.amount })), today).filter((s) => s.status === "paid").length;
  const fit = expected.length ? matched / expected.length : 0;
  if (fit < 0.75) return null;
  return { ...plan, active, endDate: plan.endDate, instalments: run.length, fit };
}
