import { describe, it, expect } from "vitest";
import { classifyHolding, parseDisclosure, pickSheet, detectAsOfMonth } from "@/lib/lookthrough/disclosure";
import { lookThrough, effectiveWeights, overlap, groupExposures, type LtDisclosure } from "@/lib/lookthrough/engine";

describe("classifyHolding", () => {
  it("reads the ISIN", () => {
    expect(classifyHolding("INE002A01018", "Reliance Industries Ltd")).toBe("equity");
    expect(classifyHolding("INE040A08377", "HDFC Bank NCD")).toBe("debt");
    expect(classifyHolding("IN0020230085", "7.18% GOI 2033")).toBe("debt");
    expect(classifyHolding("INF204KB14I2", "Some Liquid Fund")).toBe("fund");
    expect(classifyHolding("US0378331005", "Apple Inc")).toBe("foreign_equity");
  });
  it("spots cash lines and ratings without an ISIN", () => {
    expect(classifyHolding(null, "TREPS")).toBe("cash");
    expect(classifyHolding(null, "Net Receivables / (Payables)")).toBe("cash");
    expect(classifyHolding(null, "Some Finance Ltd", "", "CRISIL AAA")).toBe("debt");
  });
  it("an explicit type column wins", () => {
    expect(classifyHolding(null, "Demo Bank Ltd", "Equity")).toBe("equity");
    expect(classifyHolding(null, "Demo US Tech", "Mutual fund")).toBe("fund");
  });
});

describe("parseDisclosure (generic)", () => {
  it("parses an AMC-style sheet with a title, sections and totals", () => {
    const grid = [
      ["Demo Mutual Fund"],
      ["Portfolio of Demo Bluechip Fund as on 30-Sep-2026"],
      [],
      ["Name of the Instrument", "ISIN", "Industry / Rating", "Quantity", "Market value (Rs. Lakhs)", "% to NAV"],
      ["Equity & Equity related"],
      ["Reliance Industries Ltd", "INE002A01018", "Petroleum Products", 1000, 300, "9.50%"],
      ["HDFC Bank Ltd", "INE040A01034", "Banks", 1000, 250, "8.25"],
      ["Sub Total", "", "", "", 550, "17.75"],
      ["7.18% GOI 2033", "IN0020230085", "SOV", 1, 50, "1.50"],
      ["TREPS", "", "", "", 20, "0.75"],
      ["Grand Total", "", "", "", 620, "100.00"],
    ];
    const p = parseDisclosure(grid)!;
    expect(p.rows.map((r) => [r.name, r.kind, r.weightPct])).toEqual([
      ["Reliance Industries Ltd", "equity", 9.5],
      ["HDFC Bank Ltd", "equity", 8.25],
      ["7.18% GOI 2033", "debt", 1.5],
      ["TREPS", "cash", 0.75],
    ]);
    expect(p.rows[0].sector).toBe("Petroleum Products");
    expect(p.rows[2].sector).toBeNull(); // "SOV" is a rating, not a sector
    expect(p.totalPct).toBeCloseTo(20);
    expect(p.warnings[0]).toMatch(/not itemised/);
    expect(detectAsOfMonth(grid)).toBe("2026-09-01");
  });
  it("turns fractional weights into percent and merges duplicate lines", () => {
    const p = parseDisclosure([["name", "isin", "weight"], ["A Ltd", "INE111A01011", 0.6], ["A Ltd", "INE111A01011", 0.1], ["B Ltd", "INE222B01012", 0.3]])!;
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0].weightPct).toBeCloseTo(70);
    expect(p.totalPct).toBeCloseTo(100);
  });
  it("returns null when there is no weight column", () => {
    expect(parseDisclosure([["name", "isin"], ["A", "INE111A01011"]])).toBeNull();
  });
  it("picks the sheet that names the fund", () => {
    const sheets = [{ name: "LC01", grid: [["Demo Largecap Fund"]] }, { name: "MC02", grid: [["Demo Midcap Opportunities Fund"]] }];
    expect(pickSheet(sheets, "Demo Midcap Opportunities Fund - Direct Plan - Growth")?.name).toBe("MC02");
  });
});

describe("lookThrough", () => {
  const eq = (id: number, w: number) => ({ holdingInstrumentId: id, name: `S${id}`, isin: null, kind: "equity" as const, sector: null, weightPct: w });
  const disclosures = new Map<number, LtDisclosure>([
    [100, { asOf: "2026-09-01", lines: [eq(1, 60), eq(2, 30), { holdingInstrumentId: null, name: "TREPS", isin: null, kind: "cash", sector: null, weightPct: 10 }] }],
    [200, { asOf: "2026-09-01", lines: [eq(2, 50), eq(3, 50)] }],
    // FoF: 80% in fund 200, 20% in a fund with no disclosure
    [300, { asOf: "2026-08-01", lines: [{ holdingInstrumentId: 200, name: "Fund 200", isin: null, kind: "fund", sector: null, weightPct: 80 }, { holdingInstrumentId: 400, name: "Fund 400", isin: null, kind: "fund", sector: null, weightPct: 20 }] }],
  ]);
  const info = new Map([[1, { name: "One", capClass: "large", sector: "Banks" }], [2, { name: "Two", capClass: "mid", sector: "IT" }], [3, { name: "Three", capClass: null, sector: null }]]);

  it("adds direct and fund exposure to the same stock", () => {
    const lt = lookThrough([
      { instrumentId: 1, type: "stock", value: 1000, assetClass: "equity" },
      { instrumentId: 100, type: "mf", value: 10000, assetClass: "equity" },
    ], disclosures, info, new Map());
    const one = lt.exposures.find((e) => e.instrumentId === 1)!;
    expect(one.direct).toBe(1000);
    expect(one.viaFunds).toBeCloseTo(6000);
    expect(lt.classes.get("cash")).toBeCloseTo(1000);
    expect(lt.classes.get("equity")).toBeCloseTo(1000 + 9000);
    expect(groupExposures(lt.exposures, (e) => e.capClass).find((g) => g.name === "large")!.value).toBeCloseTo(7000);
  });
  it("resolves a fund of funds two levels deep and reports the unresolved part", () => {
    const lt = lookThrough([{ instrumentId: 300, type: "mf", value: 1000, assetClass: "international" }], disclosures, info, new Map([[400, "debt"]]));
    expect(lt.exposures.find((e) => e.instrumentId === 3)!.viaFunds).toBeCloseTo(400);
    expect(lt.exposures.find((e) => e.instrumentId === 3)!.via.get(300)).toBeCloseTo(400);
    expect(lt.classes.get("debt")).toBeCloseTo(200);
    expect(lt.coverage[0].unresolvedFunds).toEqual(["Fund 400"]);
  });
  it("funds without a disclosure stay in their own class", () => {
    const lt = lookThrough([{ instrumentId: 999, type: "mf", value: 500, assetClass: "equity" }], disclosures, info, new Map());
    expect(lt.equityNotLookedThrough).toBe(500);
    expect(lt.coverage[0].asOf).toBeNull();
  });
  it("overlap is the sum of the smaller weights of common stocks", () => {
    const o = overlap(effectiveWeights(100, disclosures), effectiveWeights(200, disclosures));
    expect(o.common).toBe(1);
    expect(o.pct).toBeCloseTo(30);
    // FoF 300 is 80% fund 200: overlap with 200 = min(40,50) + min(40,50)
    expect(overlap(effectiveWeights(300, disclosures), effectiveWeights(200, disclosures)).pct).toBeCloseTo(80);
  });
});
