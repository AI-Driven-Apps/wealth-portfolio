import { addMonths, yearsBetween } from "./dates";

// Fixed income and alternatives: values are computed from terms, never fetched.
// Banks compute broken periods as simple interest; compounding fractional
// periods here instead is a close approximation, labelled "accrued" in the UI.

export type Compounding = "monthly" | "quarterly" | "half_yearly" | "yearly" | "simple";
export type FixedKind = "fd" | "rd" | "bond" | "ppf" | "epf" | "nps" | "sgb" | "gold" | "reit" | "cash" | "other";

const FREQ: Record<Exclude<Compounding, "simple">, number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };

/** Growth factor of ₹1 over `years`. */
export function growth(ratePct: number, comp: Compounding, years: number): number {
  if (!(years > 0) || !ratePct) return 1;
  const r = ratePct / 100;
  if (comp === "simple") return 1 + r * years;
  const n = FREQ[comp];
  return Math.pow(1 + r / n, n * years);
}

/** Default asset class per kind; the design keeps fixed income and alternatives apart. */
export const KIND_CLASS: Record<FixedKind, string> = {
  fd: "debt", rd: "debt", bond: "debt", ppf: "debt", epf: "debt", nps: "debt",
  sgb: "gold", gold: "gold", reit: "real_estate", cash: "cash", other: "other",
};
export const FIXED_INCOME_KINDS: FixedKind[] = ["fd", "rd", "bond", "ppf", "epf", "nps"];
export const KIND_LABEL: Record<FixedKind, string> = {
  fd: "Fixed deposit", rd: "Recurring deposit", bond: "Bond", ppf: "PPF", epf: "EPF", nps: "NPS",
  sgb: "Sovereign gold bond", gold: "Gold", reit: "REIT / InvIT", cash: "Cash / savings", other: "Other",
};

export interface FixedInput {
  kind: FixedKind;
  principal: number;      // RD: monthly instalment
  ratePct: number;
  compounding: Compounding;
  payout: boolean;
  startDate: string;
  maturityDate: string | null;
  balance: number | null;
  balanceAsOf: string | null;
  closedOn: string | null;
}

export interface FixedValue {
  value: number;
  /** Money put in so far; null when only a balance is known (EPF/PPF entered as a balance). */
  invested: number | null;
  /** Interest paid out to you (payout FDs, bond coupons) — income, not part of value. */
  income: number;
  matured: boolean;
}

const ZERO: FixedValue = { value: 0, invested: 0, income: 0, matured: false };

/** RD deposit dates: one a month from start, stopping before maturity. */
function rdDeposits(a: FixedInput, until: string): string[] {
  const out: string[] = [];
  for (let k = 0; k < 600; k++) {
    const d = addMonths(a.startDate, k);
    if (d > until || (a.maturityDate && d >= a.maturityDate)) break;
    out.push(d);
  }
  return out;
}

/** Value of a fixed asset on `on`. No growth after maturity; zero once closed. */
export function fixedValue(a: FixedInput, on: string): FixedValue {
  if (a.closedOn && on >= a.closedOn) return ZERO;
  const matured = !!a.maturityDate && on >= a.maturityDate;
  const end = matured ? a.maturityDate! : on;

  if (a.balance != null && a.balanceAsOf) {
    if (end < a.startDate && end < a.balanceAsOf) return ZERO;
    const g = end >= a.balanceAsOf
      ? growth(a.ratePct, a.compounding, yearsBetween(a.balanceAsOf, end))
      : 1 / growth(a.ratePct, a.compounding, yearsBetween(end, a.balanceAsOf));
    return { value: a.balance * g, invested: null, income: 0, matured };
  }
  if (end < a.startDate) return ZERO;

  if (a.kind === "rd") {
    const deps = rdDeposits(a, end);
    const value = deps.reduce((s, d) => s + a.principal * growth(a.ratePct, a.compounding, yearsBetween(d, end)), 0);
    return { value, invested: a.principal * deps.length, income: 0, matured };
  }
  if (a.payout) {
    return { value: a.principal, invested: a.principal, income: a.principal * (a.ratePct / 100) * yearsBetween(a.startDate, end), matured };
  }
  return { value: a.principal * growth(a.ratePct, a.compounding, yearsBetween(a.startDate, end)), invested: a.principal, income: 0, matured };
}

export function maturityValue(a: FixedInput): number | null {
  return a.maturityDate ? fixedValue({ ...a, closedOn: null }, a.maturityDate).value : null;
}
