import { toDayNum } from "./dates";

export interface CashFlow { date: string; amount: number } // outflow < 0, inflow > 0

/** NPV with Excel's XIRR convention: (d_i - d_0) / 365. */
function npv(rate: number, flows: CashFlow[], d0: number): number {
  let s = 0;
  for (const f of flows) s += f.amount / Math.pow(1 + rate, (toDayNum(f.date) - d0) / 365);
  return s;
}

/** Brent's method on [a, b]; returns null when f(a), f(b) don't bracket a root. */
function brent(f: (x: number) => number, a: number, b: number, tol = 1e-10, maxIter = 200): number | null {
  let fa = f(a), fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let c = a, fc = fa, d = b - a, mflag = true;
  for (let i = 0; i < maxIter; i++) {
    if (Math.abs(fb) < tol || Math.abs(b - a) < tol) return b;
    let s: number;
    if (fa !== fc && fb !== fc) {
      s = (a * fb * fc) / ((fa - fb) * (fa - fc)) + (b * fa * fc) / ((fb - fa) * (fb - fc)) + (c * fa * fb) / ((fc - fa) * (fc - fb));
    } else {
      s = b - (fb * (b - a)) / (fb - fa);
    }
    const lo = (3 * a + b) / 4;
    const outside = !((s > Math.min(lo, b)) && (s < Math.max(lo, b)));
    if (outside || (mflag && Math.abs(s - b) >= Math.abs(b - c) / 2) || (!mflag && Math.abs(s - b) >= Math.abs(c - d) / 2)) {
      s = (a + b) / 2; mflag = true;
    } else mflag = false;
    const fs = f(s);
    d = c; c = b; fc = fb;
    if (fa * fs < 0) { b = s; fb = fs; } else { a = s; fa = fs; }
    if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  }
  return b;
}

function newton(f: (x: number) => number, x0: number): number | null {
  let x = x0;
  for (let i = 0; i < 100; i++) {
    const fx = f(x), h = 1e-6, d = (f(x + h) - fx) / h;
    if (!Number.isFinite(d) || d === 0) return null;
    const nx = x - fx / d;
    if (!Number.isFinite(nx) || nx <= -1) return null;
    if (Math.abs(nx - x) < 1e-10) return nx;
    x = nx;
  }
  return null;
}

/**
 * Annualised XIRR. Returns null (not 0) when it can't be trusted:
 * fewer than two flows, no sign change, under `minDays` of history, or no convergence.
 */
export function xirr(flows: CashFlow[], minDays = 30): number | null {
  const fl = flows.filter((f) => f.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  if (fl.length < 2) return null;
  if (!fl.some((f) => f.amount < 0) || !fl.some((f) => f.amount > 0)) return null;
  const d0 = toDayNum(fl[0].date);
  if (toDayNum(fl[fl.length - 1].date) - d0 < minDays) return null;
  const f = (r: number) => npv(r, fl, d0);
  const r = brent(f, -0.99, 10) ?? brent(f, -0.9999, 100) ?? newton(f, 0.1);
  return r === null || !Number.isFinite(r) ? null : r;
}
