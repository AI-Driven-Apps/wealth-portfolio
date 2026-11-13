import { describe, it, expect } from "vitest";
import { parseFnoLots, parseIndexList } from "@/lib/providers/nse";
import { categoriesOf, memberSets, SENSEX } from "@/lib/portfolio/categories";

describe("NSE index member lists", () => {
  it("reads symbols from an index constituent list", () => {
    const csv = "Company Name,Industry,Symbol,Series,ISIN Code\nAdani Enterprises Ltd.,Metals & Mining,ADANIENT,EQ,INE423A01024\nInfosys Ltd.,IT,INFY,EQ,INE009A01021\n";
    expect(parseIndexList(csv)).toEqual(["ADANIENT", "INFY"]);
  });

  it("keeps only the stock rows of the F&O lot file, padded columns and all", () => {
    const csv = [
      "UNDERLYING                          ,SYMBOL    ,OCT-26     ,NOV-26     ",
      "NIFTY BANK                          ,BANKNIFTY ,30         ,30         ",
      "NIFTY 50                            ,NIFTY     ,65         ,65         ",
      "Derivatives on Individual Securities,Symbol    ,OCT-26     ,NOV-26     ",
      "ABB INDIA LIMITED                   ,ABB       ,125        ,125        ",
      "MAHINDRA & MAHINDRA LTD             ,M&M       ,200        ,200        ",
    ].join("\n");
    expect(parseFnoLots(csv)).toEqual(["ABB", "M&M"]);
  });

  it("rejects a file it doesn't recognise rather than returning nothing", () => {
    expect(() => parseFnoLots("a,b\n1,2\n")).toThrow();
    expect(() => parseIndexList("a,b\n1,2\n")).toThrow();
  });
});

describe("52-week categories", () => {
  const sets = memberSets({ nifty50: ["INFY", "RELIANCE"], fno: ["INFY", "ABB"], asOf: "2026-10-25" });

  it("puts a stock in every index list it belongs to", () => {
    expect(categoriesOf({ type: "stock", nseSymbol: "INFY" }, sets)).toEqual(["nifty", "fno", "sensex"]);
    expect(categoriesOf({ type: "stock", nseSymbol: "ABB" }, sets)).toEqual(["fno"]);
  });

  it("files funds by type and everything else under Other", () => {
    expect(categoriesOf({ type: "mf", nseSymbol: null }, sets)).toEqual(["mf"]);
    expect(categoriesOf({ type: "etf", nseSymbol: "NIFTYBEES" }, sets)).toEqual(["etf"]);
    expect(categoriesOf({ type: "stock", nseSymbol: "SMALLCO" }, sets)).toEqual(["other"]);
    expect(categoriesOf({ type: "stock", nseSymbol: null }, sets)).toEqual(["other"]);
  });

  it("keeps a SENSEX list without duplicates", () => {
    expect(new Set(SENSEX).size).toBe(SENSEX.length);
  });
});
