import { describe, it, expect } from "vitest";
import { isExecutedStatus, statusSummary } from "@/lib/import/status";
import { brokerKey, parseCodeList } from "@/lib/import/codes";
import { parseTradebook } from "@/lib/import/tradebook";
import { parseSpreadsheet } from "@/lib/import/spreadsheet";

const csv = (s: string) => new TextEncoder().encode(s);

describe("trade status", () => {
  it("keeps only executed trades", () => {
    for (const s of ["Confirmed Trade", "CONFIRMED", "Complete", "Completed", "Executed", "Fully Executed", "Traded", "SUCCESS", "Successful", "Filled", "Allotted", "Trade Confirmed"]) expect(isExecutedStatus(s), s).toBe(true);
    for (const s of ["Expired Order", "Rejected", "Cancelled", "CANCELED", "Failed", "Pending", "Open", "Partially Executed", "Not Executed", "Unsuccessful", "Reversed", "Order Placed", "Trigger Pending", "", "Modified", "something else"]) expect(isExecutedStatus(s), s).toBe(false);
  });
});

describe("broker code lists", () => {
  it("normalises the broker name", () => {
    expect(["HDFC Securities", "HDFC Sec Ltd", "hdfc", "HDFC Securities Limited"].map(brokerKey)).toEqual(["hdfc", "hdfc", "hdfc", "hdfc"]);
    expect(brokerKey("ICICI Direct")).toBe("icici");
    expect(brokerKey("HDFC Sky")).toBe("hdfcsky");
    expect(brokerKey("")).toBe("broker");
  });
  it("reads the HDFC list layout, a table split over pages with a title row", () => {
    const grid = [
      ["Intraday", null, null, null],
      ["Sr.No.", "Security_Name", "ISIN", "Scrip_ID"],
      ["1", "3M INDIA LIMITED", "INE470A01017", "3MINDLEQNR"],
      ["2", "AARTI INDUSTRIES LTD", "INE769A01020", "AARINDEQNR"],
      ["Sr.No.", "Security_Name", "ISIN", "Scrip_ID"], // next page repeats the header
      ["3", "ABBOTT INDIA", "INE358A01014", "ABBINDEQNR"],
      ["4", "BROKEN ROW", "", "XYZEQNR"],
    ];
    const r = parseCodeList(grid);
    expect(r.found).toBe(true);
    expect(r.entries).toEqual([
      { code: "3MINDLEQNR", isin: "INE470A01017", nseSymbol: null, name: "3M INDIA LIMITED" },
      { code: "AARINDEQNR", isin: "INE769A01020", nseSymbol: null, name: "AARTI INDUSTRIES LTD" },
      { code: "ABBINDEQNR", isin: "INE358A01014", nseSymbol: null, name: "ABBOTT INDIA" },
    ]);
    expect(r.skipped).toBe(2);
  });
  it("accepts code -> NSE symbol lists, and doesn't read a name column as the code", () => {
    const r = parseCodeList([["Scrip Name", "Stock Code", "NSE Symbol"], ["Infosys Ltd", "INFTEC", "INFY"]]);
    expect(r.entries).toEqual([{ code: "INFTEC", isin: null, nseSymbol: "INFY", name: "Infosys Ltd" }]);
  });
  it("reads the approved-securities layout: InternalCode is the code, Symbol is the NSE symbol", () => {
    const grid = [
      [null, null, "Approved list of securities accepted as collateral for the Month of February, 2020", null, null, null],
      ["Sr No", "Symbol", "ISIN", "Security Name", "InternalCode", "Coll Valuation %"],
      ["1", "ADANIPORTS", "INE742F01042", "Adani Ports and Special Economic Zone Limited", "ADAPOREQNR", "75"],
      ["4", "BAJAJ-AUTO", "INE917I01010", "Bajaj Auto Limited", "BAJLTDEQNR", "75"],
      ["31", "M&M", "INE101A01026", "Mahindra & Mahindra Limited", "MAHMAHEQNR", "75"],
    ];
    const r = parseCodeList(grid);
    expect(r.entries).toEqual([
      { code: "ADAPOREQNR", isin: "INE742F01042", nseSymbol: "ADANIPORTS", name: "Adani Ports and Special Economic Zone Limited" },
      { code: "BAJLTDEQNR", isin: "INE917I01010", nseSymbol: "BAJAJ-AUTO", name: "Bajaj Auto Limited" },
      { code: "MAHMAHEQNR", isin: "INE101A01026", nseSymbol: "M&M", name: "Mahindra & Mahindra Limited" },
    ]);
  });
  it("uses Symbol as the code only when the list has no code column of its own", () => {
    const r = parseCodeList([["Symbol", "ISIN"], ["INFY", "INE009A01021"]]);
    expect(r.entries).toEqual([{ code: "INFY", isin: "INE009A01021", nseSymbol: null, name: null }]);
  });
  it("rejects a file without the columns", () => {
    expect(parseCodeList([["Date", "Amount"], ["2025-01-01", "5"]]).found).toBe(false);
  });
});

describe("tradebook status and codes", () => {
  const hdfc = [
    "Trade Date,Scrip_ID,Security Name,Buy/Sell,Quantity,Price,Status,Trade No",
    "01/09/2025,3MINDLEQNR,3M INDIA LIMITED,Buy,1,30000,Confirmed Trade,T1",
    "01/09/2025,AARINDEQNR,AARTI INDUSTRIES LTD,Buy,10,400,Expired Order,",
    "02/09/2025,AARINDEQNR,AARTI INDUSTRIES LTD,Buy,10,401,Expired Order,",
    "02/09/2025,ABBINDEQNR,ABBOTT INDIA,Sell,2,25000,Rejected,",
  ].join("\n");
  it("imports confirmed trades only and says what it left out", () => {
    const p = parseTradebook(csv(hdfc), "hdfc.csv", "HDFC Securities", "C1");
    expect(p.rows).toHaveLength(1);
    // the code column is the symbol (resolved through saved codes later); the name column is the display name
    expect(p.rows[0]).toMatchObject({ symbol: "3MINDLEQNR", name: "3M INDIA LIMITED", units: 1, price: 30000, type: "buy" });
    expect(p.skipped.map((s) => s.reason)).toEqual(['not executed (status "Expired Order")', 'not executed (status "Expired Order")', 'not executed (status "Rejected")']);
    expect(p.warnings[0]).toMatch(/Left out 3 rows .*Expired Order ×2, Rejected ×1/);
  });
  it("prefers a code/symbol column over a name column whichever comes first", () => {
    const p = parseTradebook(csv("Date,Security Name,Scrip Code,Side,Qty,Rate\n2025-09-01,Infosys Ltd,INFTEC,B,5,1500"), "x.csv", "ICICI Direct", "C");
    expect(p.rows[0]).toMatchObject({ symbol: "INFTEC", name: "Infosys Ltd" });
  });
  it("imports everything when there is no status column", () => {
    expect(parseTradebook(csv("Date,Symbol,Side,Qty,Price\n2025-09-01,INFY,BUY,5,1500"), "z.csv", "Zerodha", "Z").rows).toHaveLength(1);
  });
  it("applies the same filter to spreadsheet exports", () => {
    const p = parseSpreadsheet(csv("Date,Scheme Name,Type,Amount,NAV,Status\n2025-01-05,Demo Fund Growth,SIP,1000,10,Completed\n2025-02-05,Demo Fund Growth,SIP,1000,10,Failed"), "k.csv");
    expect(p.rows).toHaveLength(1);
    expect(statusSummary(p.skipped)).toMatch(/Failed ×1/);
  });
});

describe("HDFC Securities order log", () => {
  const H = "Name\tDate & Time\tAction\tExchange\tOrder Qty\tExecution Qty\tDiscl. Qty\tOrder Price\tTrigger Price\tOrder Type\tProduct\tStatus\tReason\tHSL Ref. No.\tExch. Order No.\tBook Type\tSett. Type\tTerminal ID\tSource\tBasketID/SIP REF. N.";
  const row = (...c: (string | number)[]) => c.join("\t");
  const file = [H,
    row("MUTFINEQNR", "14-Feb-2023 16:29:04", "BUY", "NSE", 5, 0, 0, "     990.00", "       0.00", "LIMIT", "Cash", "Expired Order", "Exch Cancelled Batch Order", "23021400165491", "1200000008031511", "Reg. Lot", "Nrml T+1", 5329187, "MOBILE", 0),
    row("MUTFINEQNR", "15-Feb-2023 10:02:11", "BUY", "NSE", 5, 5, 0, "     985.50", "       0.00", "LIMIT", "Cash", "Confirmed Trade", "", "23021500000001", "1200000008031600", "Reg. Lot", "Nrml T+1", 5329187, "MOBILE", 0),
    row("AARINDEQNR", "16-Feb-2023 11:00:00", "SELL", "NSE", 10, 4, 0, "     410.00", "       0.00", "LIMIT", "Cash", "Expired Order", "Exch Cancelled Batch Order", "23021600000002", "1200000008031700", "Reg. Lot", "Nrml T+1", 5329187, "WEB", 0),
    row("ABBINDEQNR", "17-Feb-2023 09:20:00", "BUY", "NSE", 1, 1, 0, "       0.00", "       0.00", "MARKET", "Cash", "Confirmed Trade", "", "23021700000003", "1200000008031800", "Reg. Lot", "Nrml T+1", 5329187, "WEB", 0),
    row("ACCLTDEQNR", "17-Feb-2023 09:21:00", "BUY", "NSE", 2, 0, 0, "    1800.00", "       0.00", "LIMIT", "Cash", "Rejected", "Insufficient funds", "23021700000004", "", "Reg. Lot", "Nrml T+1", 5329187, "WEB", 0),
  ].join("\n");

  for (const name of ["trade-log.csv", "trade-log.xls"]) it(`reads the tab-separated export (${name})`, () => {
    const p = parseTradebook(csv(file), name, "HDFC Securities", "C1");
    expect(p.rows.map((r) => [r.symbol, r.date, r.type, r.units, r.price])).toEqual([
      ["MUTFINEQNR", "2023-02-15", "buy", 5, 985.5],
      ["AARINDEQNR", "2023-02-16", "sell", 4, 410], // 4 of 10 filled before the rest expired
    ]);
    expect(p.rows[1].note).toMatch(/4 of 10 executed; order status "Expired Order"/);
    expect(p.rows[0].dedupKey).toBe("trade|hdfc securities|1200000008031600");
    expect(p.skipped.map((s) => s.reason)).toEqual(['not executed (status "Expired Order")', "no execution price", 'not executed (status "Rejected")']);
    expect(p.skipped[0].detail).toMatch(/Exch Cancelled Batch Order/);
    expect(p.warnings.join(" ")).toMatch(/Left out 2 rows that weren't executed: Expired Order ×1, Rejected ×1/);
    expect(p.warnings.join(" ")).toMatch(/order log/);
  });
});
