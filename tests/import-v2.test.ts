import { describe, it, expect } from "vitest";
import { parseSpreadsheet, normaliseType, TXN_TEMPLATE } from "@/lib/import/spreadsheet";
import { parseFixedSheet, parseLoanSheet, FIXED_TEMPLATE, LOAN_TEMPLATE } from "@/lib/import/records";
import { detectSip } from "@/lib/calc/sipDetect";
import { addMonths } from "@/lib/calc/dates";

const csv = (s: string) => new TextEncoder().encode(s);

describe("spreadsheet transactions", () => {
  it("reads the template", () => {
    const p = parseSpreadsheet(csv(TXN_TEMPLATE), "t.csv");
    expect(p.skipped).toEqual([]);
    expect(p.rows.map((r) => [r.type, r.assetHint, r.account.kind])).toEqual([
      ["sip", "mf", "folio"], ["buy", "unknown", "demat"], ["sell", "unknown", "demat"], ["dividend_payout", "unknown", "demat"],
    ]);
    const sip = p.rows[0];
    expect(sip.amfiCode).toBe("122639");
    expect(sip).toMatchObject({ units: 68.123, price: 73.39, amount: 5000, fees: 0.25 });
  });
  it("derives the missing one of units, price and amount", () => {
    const p = parseSpreadsheet(csv("Scheme Name,Transaction Type,Date,NAV,Units,Amount\nAxis Bluechip Fund - Direct Growth,Purchase SIP,05/04/2024,50,,1000\nAxis Bluechip Fund - Direct Growth,Redemption,05/04/2025,62.5,8,"), "kuvera.csv");
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ type: "sip", date: "2024-04-05", units: 20, price: 50, amount: 1000, assetHint: "mf" });
    expect(p.rows[1]).toMatchObject({ type: "sell", units: 8, amount: 500 });
  });
  it("lets the preview re-map a column", () => {
    const file = csv("When,Fund,Kind,Qty,Cost\n2024-01-10,Demo Fund Growth,buy,10,1000");
    expect(parseSpreadsheet(file, "x.csv").columns).toBeNull(); // no "date"-like header
    const file2 = csv("Date,Fund,Kind,Qty,Cost\n2024-01-10,Demo Fund Growth,buy,10,1000");
    const p = parseSpreadsheet(file2, "x.csv");
    expect(p.columns!.map.type).toBeUndefined();
    const p2 = parseSpreadsheet(file2, "x.csv", { type: 2, amount: 4 });
    expect(p2.rows[0]).toMatchObject({ type: "buy", units: 10, amount: 1000, price: 100 });
  });
  it("normalises platform wording", () => {
    expect(normaliseType("Purchase - Systematic")).toBe("sip");
    expect(normaliseType("SWITCH IN")).toBe("switch_in");
    expect(normaliseType("IDCW Reinvestment")).toBe("dividend_reinvest");
    expect(normaliseType("Dividend Payout")).toBe("dividend_payout");
    expect(normaliseType("S")).toBe("sell");
    expect(normaliseType("Lumpsum")).toBe("buy");
    expect(normaliseType("Pledge")).toBeNull();
  });
});

describe("deposits and loans", () => {
  it("reads the deposits template", () => {
    const p = parseFixedSheet(csv(FIXED_TEMPLATE), "f.csv");
    expect(p.skipped).toEqual([]);
    expect(p.rows.map((r) => r.kind)).toEqual(["fd", "rd", "ppf", "epf", "gold", "cash", "other"]);
    expect(p.rows[2]).toMatchObject({ balance: 650000, balanceAsOf: "2026-04-01", compounding: "yearly" });
    expect(p.rows[6].assetClass).toBe("real_estate");
  });
  it("skips unusable deposit rows with a reason", () => {
    const p = parseFixedSheet(csv("kind,name,amount,start_date,maturity_date\nRD,No end,1000,2025-01-01,\nCrypto,Coins,100,2025-01-01,"), "f.csv");
    expect(p.rows).toEqual([]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["RD needs a maturity date", 'unknown kind "Crypto"']);
  });
  it("reads loans with their events", () => {
    const p = parseLoanSheet(csv(LOAN_TEMPLATE), "l.csv");
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ name: "Home loan", kind: "home", tenureMonths: 240, principal: 3500000 });
    expect(p.rows[0].events).toEqual([
      { date: "2024-03-15", kind: "prepayment", amount: 300000, ratePct: null, reduce: "tenure" },
      { date: "2025-06-01", kind: "rate_change", amount: null, ratePct: 8.4, reduce: "emi" },
    ]);
    expect(p.rows[1].emi).toBe(12513);
  });
  it("keeps events for a loan that isn't in the file, and accepts tenure in years", () => {
    const p = parseLoanSheet(csv("loan,principal,rate,tenure,first_emi_date,event,event_date,event_amount\nCar,500000,9,5 years,2024-01-10,,,\nOld home loan,,,,,prepayment,2025-02-01,100000"), "l.csv");
    expect(p.rows[0].tenureMonths).toBe(60);
    expect(p.rows[1]).toMatchObject({ name: "old home loan", principal: 0 });
    expect(p.rows[1].events).toHaveLength(1);
  });
});

describe("SIP detection", () => {
  const today = "2026-10-17";
  const monthly = (start: string, n: number, amount: (i: number) => number, jitter = (i: number) => 0) =>
    Array.from({ length: n }, (_, i) => {
      const d = addMonths(start, i);
      const dd = Math.min(Math.max(Number(d.slice(8)) + jitter(i), 1), 28);
      return { date: `${d.slice(0, 8)}${String(dd).padStart(2, "0")}`, amount: amount(i), type: "sip" };
    });

  it("finds a running SIP despite holiday shifts", () => {
    const d = detectSip(monthly("2025-01-05", 22, () => 5000, (i) => (i % 4 === 0 ? 2 : 0)), today)!;
    expect(d).toMatchObject({ dayOfMonth: 5, amount: 5000, stepUpPct: 0, active: true, endDate: null, startDate: "2025-01-01" });
    expect(d.fit).toBeGreaterThanOrEqual(0.95);
  });
  it("detects a yearly step-up", () => {
    const d = detectSip(monthly("2023-04-12", 42, (i) => Math.round(4000 * Math.pow(1.1, Math.floor(i / 12)))), today)!;
    expect(d.stepUpPct).toBe(10);
    expect(d.amount).toBe(4000);
  });
  it("marks a stopped SIP and tolerates one missed month", () => {
    const rows = monthly("2022-01-20", 18, () => 3000).filter((_, i) => i !== 7);
    const d = detectSip(rows, today)!;
    expect(d.active).toBe(false);
    expect(d.endDate).toBe("2023-06-20");
  });
  it("ignores scattered lump sums", () => {
    expect(detectSip([
      { date: "2024-01-03", amount: 50000, type: "buy" }, { date: "2024-05-22", amount: 20000, type: "buy" }, { date: "2025-02-11", amount: 10000, type: "buy" },
    ], today)).toBeNull();
  });
});
