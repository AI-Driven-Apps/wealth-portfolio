import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { mapCas } from "@/lib/import/cas";
import { parseTradebook } from "@/lib/import/tradebook";
import { mapContractNote } from "@/lib/import/contractNote";
import { buildPosition } from "@/lib/calc/fifo";

// Shape of casparser 1.4 output (output="json") for a CAMS detailed statement.
const camsJson = {
  file_type: "CAMS", cas_type: "DETAILED",
  statement_period: { from: "01-Jan-2023", to: "15-Oct-2026" },
  folios: [{
    folio: "1234567/89", amc: "Axis Mutual Fund",
    schemes: [{
      scheme: "Axis Large Cap Fund - Direct Growth", isin: "INF846K01DP8", amfi: "120465", rta: "KFINTECH",
      transactions: [
        { date: "2023-01-05", description: "SIP Purchase", amount: "4999.75", units: "100.000", nav: "49.9975", type: "PURCHASE_SIP" },
        { date: "2023-01-05", description: "*** Stamp Duty ***", amount: "0.25", units: null, nav: null, type: "STAMP_DUTY_TAX" },
        { date: "2023-02-06", description: "SIP Purchase", amount: "5000", units: "98.5", nav: "50.76", type: "PURCHASE_SIP" },
        { date: "2023-03-06", description: "SIP Purchase (Reversal)", amount: "-5000", units: "-98.5", nav: "50.76", type: "REVERSAL" },
        { date: "2024-06-10", description: "Redemption", amount: "-3000", units: "-50", nav: "60", type: "REDEMPTION" },
        { date: "2024-06-10", description: "*** STT Paid ***", amount: "0.03", units: null, nav: null, type: "STT_TAX" },
        { date: "2024-07-01", description: "Address updated", amount: null, units: null, nav: null, type: "MISC" },
      ],
    }],
  }],
};

describe("CAS mapping", () => {
  it("maps MF transactions, folds stamp duty and STT into fees, skips MISC", () => {
    const p = mapCas(camsJson, "cas.pdf");
    expect(p.source).toBe("cas");
    expect(p.rows.map((r) => r.type)).toEqual(["sip", "sip", "sell", "sell"]);
    expect(p.rows[0]).toMatchObject({ amfiCode: "120465", isin: "INF846K01DP8", units: 100, amount: 4999.75, fees: 0.25, account: { kind: "folio", ref: "1234567/89" } });
    expect(p.rows[3].fees).toBeCloseTo(0.03);
    expect(p.skipped).toHaveLength(1);
    // reversal cancels the bounced SIP: 100 + 98.5 - 98.5 - 50 = 50 units left
    const pos = buildPosition(p.rows);
    expect(pos.units).toBeCloseTo(50);
  });
  it("dedup keys are stable across re-imports", () => {
    expect(mapCas(camsJson, "a.pdf").rows.map((r) => r.dedupKey)).toEqual(mapCas(camsJson, "b.pdf").rows.map((r) => r.dedupKey));
  });
  it("warns on summary statements", () => {
    expect(mapCas({ ...camsJson, cas_type: "SUMMARY" }, "x").warnings.join(" ")).toMatch(/DETAILED/);
  });
  it("maps demat holdings as opening balances", () => {
    const p = mapCas({
      file_type: "CDSL", statement_period: { from: "01-Sep-2026", to: "30-Sep-2026" },
      accounts: [{ name: "CDSL", type: "CDSL", dp_id: "12081600", client_id: "00012345",
        equities: [{ name: "INFOSYS LTD", isin: "INE009A01021", num_shares: "10", price: "1500", value: "15000" }],
        mutual_funds: [{ name: "Some Fund", isin: "INF000000001", balance: "20", nav: "50", avg_cost: "40", value: "1000" }] }],
    }, "demat.pdf");
    expect(p.source).toBe("demat_cas");
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ date: "2026-09-30", units: 10, price: 1500, account: { kind: "demat", ref: "1208160000012345" } });
    expect(p.rows[1]).toMatchObject({ assetHint: "mf", price: 40 });
  });
});

function xlsx(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Trades");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("tradebook", () => {
  it("reads a Zerodha-style CSV and skips F&O", () => {
    const csv = [
      "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time",
      "INFY,INE009A01021,2024-03-05,NSE,EQ,EQ,buy,false,10,1600.5,1001,9001,2024-03-05T10:00:00",
      "INFY,INE009A01021,2024-03-05,NSE,EQ,EQ,buy,false,5,1601,1002,9001,2024-03-05T10:00:01",
      "NIFTYBEES,INF204KB14I2,2024-04-01,NSE,EQ,EQ,sell,false,20,250,1003,9002,2024-04-01T10:00:00",
      "NIFTY24APR22500CE,,2024-04-02,NFO,FO,,buy,false,50,100,1004,9003,2024-04-02T10:00:00",
    ].join("\n");
    const p = parseTradebook(new TextEncoder().encode(csv), "tb.csv", "Zerodha", "AB1234");
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ symbol: "INFY", isin: "INE009A01021", date: "2024-03-05", type: "buy", units: 10, price: 1600.5 });
    expect(p.rows[2]).toMatchObject({ symbol: "NIFTYBEES", type: "sell", units: 20 });
    expect(p.skipped[0].reason).toBe("derivative");
    expect(p.rows[0].dedupKey).toBe("trade|zerodha|1001");
  });
  it("finds a header below title rows in XLSX, uses value when price is absent, DD-MM-YYYY dates", () => {
    const buf = xlsx([
      ["Tradebook for AB1234"], ["From 01-04-2024 to 31-03-2025"], [],
      ["Scrip Name", "ISIN", "Trade Date", "Buy/Sell", "Qty", "Trade Value"],
      ["HDFCBANK-EQ", "INE040A01034", "15-05-2024", "B", 4, 6000],
      ["Total", null, null, null, null, 6000],
    ]);
    const p = parseTradebook(buf, "tb.xlsx", "ICICI Direct", "X1");
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ symbol: "HDFCBANK", date: "2024-05-15", type: "buy", units: 4, price: 1500 });
  });
  it("explains when no header matches", () => {
    const p = parseTradebook(new TextEncoder().encode("a,b\n1,2"), "x.csv", "B", "A");
    expect(p.rows).toHaveLength(0);
    expect(p.warnings[0]).toMatch(/header/);
  });
});

describe("contract note", () => {
  it("spreads statutory charges across trades by value and adds brokerage from net rate", () => {
    const p = mapContractNote({
      trade_date: "2024-03-05",
      trades: [
        { side: "buy", quantity: 10, price: 100, net_rate: 100.2, security: "INFY - NSE", isin: "INE009A01021", trade_no: "77", date: null },
        { side: "sell", quantity: 30, price: 100, net_rate: null, security: "TCS", isin: null, trade_no: "78", date: null },
      ],
      charges: { stt: 3, stamp: 1, brokerage: 2 }, total_charges: 6,
    }, "cn.pdf", "Zerodha", "AB1234");
    expect(p.rows[0].fees).toBeCloseTo(2 + 1); // brokerage 0.2*10 + 1/4 of (6-2)
    expect(p.rows[1].fees).toBeCloseTo(3);
    expect(p.rows[0].dedupKey).toBe("trade|zerodha|77");
    expect(p.rows[0].date).toBe("2024-03-05");
  });
});
