import { describe, it, expect } from "vitest";
import { expectedInstalments, matchInstalments } from "@/lib/calc/sip";
import { parseNavAll, parseMfapiHistory, classifyScheme } from "@/lib/providers/amfi";
import { parseCsv, parseLooseDate, parseNumber } from "@/lib/import/tabular";

describe("SIP schedule", () => {
  const plan = { amount: 5000, dayOfMonth: 5, stepUpPct: 10, startDate: "2025-01-10", endDate: null };

  it("starts the month after if the start day is past the SIP day, and steps up yearly", () => {
    const due = expectedInstalments(plan, "2026-03-31");
    expect(due[0]).toEqual({ due: "2025-02-05", amount: 5000 });
    expect(due[12]).toEqual({ due: "2026-02-05", amount: 5500 });
    expect(due).toHaveLength(14);
  });

  it("clamps day 31 to month end", () => {
    const due = expectedInstalments({ ...plan, dayOfMonth: 31, startDate: "2026-01-01", stepUpPct: 0 }, "2026-03-31");
    expect(due.map((d) => d.due)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("matches purchases within tolerance and flags missed ones", () => {
    const exp = expectedInstalments({ ...plan, stepUpPct: 0 }, "2025-05-31");
    const st = matchInstalments(exp, [
      { date: "2025-02-06", amount: 4999.75 },
      { date: "2025-04-07", amount: 5000 },
    ], "2025-05-20");
    expect(st.map((s) => s.status)).toEqual(["paid", "missed", "paid", "missed"]);
  });

  it("keeps an instalment upcoming during the grace window", () => {
    const exp = expectedInstalments({ ...plan, stepUpPct: 0 }, "2025-02-28");
    expect(matchInstalments(exp, [], "2025-02-08")[0].status).toBe("upcoming");
  });
});

describe("AMFI NAVAll parser", () => {
  const text = [
    "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
    "",
    "Open Ended Schemes(Equity Scheme - Large Cap Fund)",
    "",
    "Axis Mutual Fund",
    "",
    "120465;INF846K01DP8;-;Axis Large Cap Fund - Direct Plan - Growth;62.4100;15-Oct-2026",
    "",
    "Open Ended Schemes(Other Scheme - Other  ETFs)",
    "Nippon India Mutual Fund",
    "140088;INF204KB17I5;-;Nippon India ETF Gold BeES;71.2300;15-Oct-2026",
    "Open Ended Schemes(Other Scheme - FoF Overseas)",
    "Some AMC",
    "999;INF000000001;-;Some US Equity FoF - Direct - Growth;N.A.;15-Oct-2026",
  ].join("\n");
  it("reads category, AMC, ISIN, NAV and classification", () => {
    const s = parseNavAll(text);
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ amfiCode: "120465", isinGrowth: "INF846K01DP8", amc: "Axis Mutual Fund", nav: 62.41, navDate: "2026-10-15", underlying: "equity", capClass: "large", isEtf: false });
    expect(s[1]).toMatchObject({ isEtf: true, underlying: "gold" });
    expect(s[2]).toMatchObject({ isFof: true, nav: null, underlying: "international" });
  });
  it("classifies hybrid and debt", () => {
    expect(classifyScheme("Hybrid Scheme - Balanced Advantage", "X").underlying).toBe("hybrid");
    expect(classifyScheme("Debt Scheme - Gilt Fund", "X").underlying).toBe("debt");
  });
  it("parses mfapi history ascending", () => {
    const h = parseMfapiHistory({ data: [{ date: "02-01-2024", nav: "11.5" }, { date: "01-01-2024", nav: "11.0" }] });
    expect(h).toEqual([{ date: "2024-01-01", close: 11 }, { date: "2024-01-02", close: 11.5 }]);
  });
});

describe("tabular helpers", () => {
  it("csv with quotes", () => {
    expect(parseCsv('a,b\n"x, y","z""q"\r\n')).toEqual([["a", "b"], ["x, y", 'z"q']]);
  });
  it("dates and numbers", () => {
    expect(parseLooseDate("05/03/2024")).toBe("2024-03-05");
    expect(parseLooseDate("5-Mar-2024")).toBe("2024-03-05");
    expect(parseLooseDate(45356)).toBe("2024-03-05");
    expect(parseNumber("₹1,23,456.50")).toBe(123456.5);
    expect(parseNumber("(250)")).toBe(-250);
  });
});

describe("AMFI NAVAll — 2026 eight-column layout", () => {
  const text = [
    "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
    " ",
    "Open Ended Schemes(Children’s Fund - Childrens' Fund)",
    " ",
    "Axis Mutual Fund",
    " ",
    "135762;INF846K01WO1;-;Axis Children's Fund;Direct Plan;Growth Option;29.3960;16-Oct-2026",
    "135763;INF846K01WS2;INF846K01WQ6;Axis Children's Fund;Direct Plan;IDCW Option;27.1302;16-Oct-2026",
    "Open Ended Schemes(Debt Scheme - Liquid Fund)",
    "Axis Mutual Fund",
    "120389;INF846K01CH7;-;Axis Liquid Fund;Regular Plan;Growth Option;2911.2001;16-Oct-2026",
  ].join("\n");
  it("reads plan and option columns and keeps NAV/date positions right", () => {
    const s = parseNavAll(text);
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ amfiCode: "135762", name: "Axis Children's Fund - Direct Plan - Growth Option", nav: 29.396, navDate: "2026-10-16", amc: "Axis Mutual Fund", category: "Children’s Fund - Childrens' Fund" });
    expect(s[1]).toMatchObject({ isinGrowth: "INF846K01WS2", isinReinvest: "INF846K01WQ6" });
    expect(s[2]).toMatchObject({ underlying: "liquid", nav: 2911.2001 });
  });
});
