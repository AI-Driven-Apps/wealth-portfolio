import { describe, it, expect } from "vitest";
import { xirr } from "@/lib/calc/xirr";
import { cagr, trailingReturn, maxDrawdown, range52w } from "@/lib/calc/returns";
import { buildPosition, type LedgerTxn } from "@/lib/calc/fifo";
import { addYears } from "@/lib/calc/dates";

describe("xirr", () => {
  it("matches Excel on a known example", () => {
    // Excel XIRR example: -10000, 2750, 4250, 3250, 2750 -> 0.373362535
    const r = xirr([
      { date: "2008-01-01", amount: -10000 }, { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 }, { date: "2009-02-15", amount: 3250 },
      { date: "2009-04-01", amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.373362535, 6);
  });
  it("one year lump sum at +12% gives 12%", () => {
    expect(xirr([{ date: "2023-01-01", amount: -100 }, { date: "2024-01-01", amount: 112 }])).toBeCloseTo(0.12, 3);
  });
  it("handles a loss", () => {
    expect(xirr([{ date: "2023-01-01", amount: -100 }, { date: "2024-01-01", amount: 80 }])).toBeCloseTo(-0.2, 3);
  });
  it("monthly SIP with flat NAV is ~0%", () => {
    const flows = Array.from({ length: 24 }, (_, i) => ({ date: addYears("2022-01-05", 0).slice(0, 5) + String(((i % 12) + 1)).padStart(2, "0") + "-05", amount: -1000 }));
    const fl = flows.map((f, i) => ({ ...f, date: `${2022 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-05` }));
    fl.push({ date: "2024-01-05", amount: 24000 });
    expect(xirr(fl)).toBeCloseTo(0, 4);
  });
  it("returns null for too-short or one-sided flows", () => {
    expect(xirr([{ date: "2024-01-01", amount: -100 }, { date: "2024-01-10", amount: 101 }])).toBeNull();
    expect(xirr([{ date: "2024-01-01", amount: -100 }, { date: "2025-01-10", amount: -101 }])).toBeNull();
  });
});

describe("returns", () => {
  it("cagr", () => {
    expect(cagr(100, 200, 5)).toBeCloseTo(0.148698, 5);
    expect(cagr(0, 200, 5)).toBeNull();
  });
  it("trailing 1y is absolute-ish, 3y is CAGR", () => {
    const s = [{ date: "2021-01-01", close: 100 }, { date: "2023-01-01", close: 110 }, { date: "2024-01-01", close: 121 }];
    expect(trailingReturn(s, 1)).toBeCloseTo(0.1, 6);
    expect(trailingReturn(s, 3)).toBeCloseTo(Math.pow(1.21, 1 / (1095 / 365)) - 1, 4);
    expect(trailingReturn(s, 5)).toBeNull();
  });
  it("max drawdown", () => { expect(maxDrawdown([100, 120, 90, 130])).toBeCloseTo(-0.25, 6); });
  it("52w range", () => {
    const r = range52w([{ date: "2023-11-30", close: 50 }, { date: "2024-06-01", close: 100 }, { date: "2024-12-01", close: 75 }]);
    expect(r?.high).toBe(100); expect(r?.low).toBe(75);
  });
});

describe("fifo", () => {
  const t = (date: string, type: LedgerTxn["type"], units: number, price: number, amount = units * price, fees = 0): LedgerTxn => ({ date, type, units, price, amount, fees });

  it("sells oldest lots first", () => {
    const p = buildPosition([t("2023-01-01", "buy", 10, 100), t("2023-06-01", "buy", 10, 200), t("2024-01-01", "sell", 15, 300)]);
    expect(p.units).toBeCloseTo(5);
    expect(p.invested).toBeCloseTo(1000);
    // sold 10@100 + 5@200 = 2000 cost, proceeds 4500
    expect(p.realized).toBeCloseTo(2500);
    expect(p.realizedGains).toHaveLength(2);
  });
  it("split rescales lots, bonus adds zero-cost lot", () => {
    const p = buildPosition([t("2023-01-01", "buy", 10, 100), t("2023-02-01", "split", 2, 0, 0), t("2023-03-01", "bonus", 20, 0, 0)]);
    expect(p.units).toBeCloseTo(40);
    expect(p.invested).toBeCloseTo(1000);
    expect(p.avgCost).toBeCloseTo(25);
  });
  it("dividend reinvest adds units but no external flow; payout is income", () => {
    const p = buildPosition([t("2023-01-01", "sip", 10, 10), t("2023-02-01", "dividend_reinvest", 1, 10), t("2023-03-01", "dividend_payout", 0, 0, 50)]);
    expect(p.units).toBeCloseTo(11);
    expect(p.flows.filter((f) => f.amount < 0)).toHaveLength(1);
    expect(p.dividends).toBe(50);
  });
  it("fees go into cost and come out of proceeds", () => {
    const p = buildPosition([t("2023-01-01", "buy", 10, 100, 1000, 10), t("2023-06-01", "sell", 10, 110, 1100, 10)]);
    expect(p.realized).toBeCloseTo(1090 - 1010);
  });
  it("warns on overselling", () => {
    const p = buildPosition([t("2023-01-01", "buy", 1, 100), t("2023-06-01", "sell", 2, 110)]);
    expect(p.warnings.length).toBe(1);
    expect(p.units).toBe(0);
  });
});
