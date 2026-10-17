import { describe, it, expect } from "vitest";
import { fixedValue, maturityValue, growth, type FixedInput } from "@/lib/calc/fixed";
import { amortise, emiFor, loanStatus, outstandingOn, prepaymentImpact } from "@/lib/calc/loan";
import { addMonths, monthEnds } from "@/lib/calc/dates";

const base: FixedInput = { kind: "fd", principal: 100000, ratePct: 7, compounding: "quarterly", payout: false, startDate: "2025-01-01", maturityDate: "2026-01-01", balance: null, balanceAsOf: null, closedOn: null };

describe("fixed assets", () => {
  it("cumulative FD: 1 lakh at 7% compounded quarterly for a year", () => {
    expect(maturityValue(base)).toBeCloseTo(107185.9, 0);
    expect(fixedValue(base, "2024-12-31").value).toBe(0);
    // no growth after maturity
    expect(fixedValue(base, "2027-06-01").value).toBeCloseTo(107185.9, 0);
    expect(fixedValue(base, "2027-06-01").matured).toBe(true);
    expect(fixedValue({ ...base, closedOn: "2026-02-01" }, "2026-03-01").value).toBe(0);
  });
  it("payout FD keeps its principal and books interest as income", () => {
    const v = fixedValue({ ...base, payout: true }, "2025-07-02");
    expect(v.value).toBe(100000);
    expect(v.income).toBeCloseTo((100000 * 0.07 * 182) / 365, 6);
  });
  it("RD: each instalment compounds from its own date", () => {
    const rd: FixedInput = { ...base, kind: "rd", principal: 5000, startDate: "2025-01-05", maturityDate: "2026-01-05" };
    const v = fixedValue(rd, "2026-01-05");
    expect(v.invested).toBe(60000);
    const expected = Array.from({ length: 12 }, (_, k) => 5000 * growth(7, "quarterly", (Date.parse("2026-01-05") - Date.parse(addMonths("2025-01-05", k))) / (365 * 86_400_000)))
      .reduce((a, b) => a + b, 0);
    expect(v.value).toBeCloseTo(expected, 6);
    expect(v.value).toBeGreaterThan(62000);
    expect(v.value).toBeLessThan(62600);
  });
  it("balance-based assets grow forward and discount back from the balance date", () => {
    const ppf: FixedInput = { ...base, kind: "ppf", ratePct: 7.1, compounding: "yearly", startDate: "2015-04-01", maturityDate: null, balance: 500000, balanceAsOf: "2026-04-01" };
    expect(fixedValue(ppf, "2027-04-01").value).toBeCloseTo(535500, 0);
    expect(fixedValue(ppf, "2025-04-01").value).toBeCloseTo(500000 / 1.071, -1);
    expect(fixedValue(ppf, "2027-04-01").invested).toBeNull();
  });
});

describe("loans", () => {
  const home = { principal: 1_000_000, ratePct: 8.5, tenureMonths: 240, firstEmiDate: "2020-01-05" };

  it("EMI matches the standard formula (10 L, 8.5%, 20 years)", () => {
    expect(emiFor(1_000_000, 8.5, 240)).toBeCloseTo(8678.23, 2);
  });
  it("schedule pays off exactly over the tenure", () => {
    const s = amortise(home);
    expect(s).toHaveLength(240);
    expect(s.at(-1)!.closing).toBe(0);
    expect(s[0].interest).toBeCloseTo(7083.33, 2);
    const total = s.reduce((a, r) => a + r.principal, 0);
    expect(total).toBeCloseTo(1_000_000, 2);
  });
  it("status on a date assumes EMIs paid on schedule", () => {
    const s = amortise(home);
    const st = loanStatus(home, s, "2021-01-04");
    expect(st.paidCount).toBe(12);
    expect(st.leftCount).toBe(228);
    expect(st.outstanding).toBeCloseTo(s[11].closing, 2);
    expect(outstandingOn(home, s, "2019-12-31")).toBe(1_000_000);
  });
  it("a prepayment shortens the tenure and saves interest", () => {
    const ev = [{ date: "2022-06-01", kind: "prepayment" as const, amount: 200000, reduce: "tenure" as const }];
    const s = amortise(home, ev);
    expect(s.length).toBeLessThan(240);
    expect(s.at(-1)!.closing).toBe(0);
    const imp = prepaymentImpact(home, ev);
    expect(imp.interestSaved).toBeGreaterThan(200000);
    expect(imp.monthsSaved).toBe(240 - s.filter((r) => r.emi > 0).length);
  });
  it("a prepayment that reduces the EMI keeps the end date", () => {
    const s = amortise(home, [{ date: "2022-06-01", kind: "prepayment", amount: 200000, reduce: "emi" }]);
    expect(s).toHaveLength(240);
    expect(s[40].emi).toBeLessThan(s[20].emi);
  });
  it("a rate rise with EMI kept stretches the tenure", () => {
    const s = amortise(home, [{ date: "2023-01-01", kind: "rate_change", ratePct: 9.5, reduce: "tenure" }]);
    expect(s.length).toBeGreaterThan(240);
    expect(s.at(-1)!.closing).toBe(0);
    expect(s[40].ratePct).toBe(9.5);
  });
});

describe("dates", () => {
  it("addMonths clamps to month end", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2024-11-15", 3)).toBe("2025-02-15");
  });
  it("monthEnds ends on the given day", () => {
    expect(monthEnds("2026-01-10", "2026-03-17")).toEqual(["2026-01-31", "2026-02-28", "2026-03-17"]);
  });
});
