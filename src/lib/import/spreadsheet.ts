// Transactions from any spreadsheet: our template, or another platform's order
// history (Groww, Kuvera, Coin, older brokers) or your own records. Columns
// are matched by header alias and can be re-mapped in the preview.
import { applyOverrides, detectColumns, readGrids, text, cell, type Aliases, type ColumnMap } from "./columns";
import { parseLooseDate, parseNumber } from "./tabular";
import { dedup, type ImportPreview, type ImportRow } from "./types";
import { STATUS_ALIASES, isExecutedStatus, notExecuted, statusSummary } from "./status";
import type { TxnType } from "@/lib/calc/fifo";

export { TXN_FIELDS } from "./fields";

const ALIASES: Aliases = {
  date: ["date", "transactiondate", "tradedate", "orderdate", "navdate", "allotmentdate", "txndate", "dateoftransaction"],
  type: ["type", "transactiontype", "txntype", "action", "side", "buysell", "ordertype", "transaction", "nature"],
  name: ["name", "schemename", "scheme", "fundname", "fund", "security", "securityname", "stock", "stockname", "companyname", "instrument", "holding"],
  symbol: ["symbol", "nsesymbol", "ticker", "tradingsymbol", "scrip"],
  isin: ["isin", "isincode"],
  amfi: ["amficode", "amfi", "schemecode", "amfischemecode"],
  units: ["units", "quantity", "qty", "shares", "allottedunits", "noofunits"],
  price: ["price", "nav", "rate", "purchaseprice", "navprice", "tradeprice", "avgprice", "unitprice"],
  amount: ["amount", "value", "investedamount", "transactionamount", "netamount", "totalamount", "amountinr", "amountrs"],
  fees: ["charges", "fees", "stampduty", "brokerage", "totalcharges"],
  account: ["folio", "folionumber", "foliono", "account", "accountno", "dematid", "clientid"],
  platform: ["platform", "broker", "amc", "rta", "source"],
  status: STATUS_ALIASES,
};

/** "Purchase - SIP", "Redemption", "SELL", "Dividend Payout"… → ledger type. */
export function normaliseType(raw: string): TxnType | null {
  const s = raw.toLowerCase().replace(/[^a-z ]/g, " ");
  if (/switch\s*in/.test(s)) return "switch_in";
  if (/switch\s*out/.test(s)) return "switch_out";
  if (/(div\w*|idcw)\s*(re-?invest|reinv)/.test(s)) return "dividend_reinvest";
  if (/div|idcw/.test(s)) return "dividend_payout";
  if (/\bsip\b|systematic/.test(s)) return "sip";
  if (/bonus/.test(s)) return "bonus";
  if (/split/.test(s)) return "split";
  if (/^\s*(s|sell|sold|sale|redeem|redemption|withdraw)/.test(s) || /redemption|\bsell\b|\bswp\b/.test(s)) return "sell";
  if (/^\s*(b|buy|bought|purchase|invest|lumpsum|lump sum|additional)/.test(s) || /purchase|\bbuy\b/.test(s)) return "buy";
  return null;
}

export interface SpreadsheetPreview extends ImportPreview { columns: { headers: string[]; map: Record<string, number>; sheet: string } | null }

export function parseSpreadsheet(buf: Uint8Array, filename: string, overrides: Record<string, number> = {}, platformDefault = "Spreadsheet"): SpreadsheetPreview {
  const rows: ImportRow[] = [];
  const skipped: ImportPreview["skipped"] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  let cm: ColumnMap | null = null, sheet = "";
  for (const s of readGrids(buf, filename)) {
    const found = detectColumns(s.grid, ALIASES, [["date"], ["name", "symbol", "isin", "amfi"], ["units", "amount"]]);
    if (!found) continue;
    cm = applyOverrides(found, overrides);
    sheet = s.name;
    for (const row of s.grid.slice(found.headerRow + 1)) {
      if (!row.some((c) => c != null && String(c).trim() !== "")) continue;
      const name = text(row, cm, "name"), symRaw = text(row, cm, "symbol").toUpperCase();
      const isinRaw = text(row, cm, "isin").toUpperCase(), amfiRaw = text(row, cm, "amfi");
      if (!name && !symRaw && !isinRaw && !amfiRaw) continue; // totals / notes
      const where = `${name || symRaw || isinRaw || amfiRaw}`;
      // Failed SIP debits, rejected / expired orders: in the export, not in the portfolio.
      if (cm.map.status !== undefined && !isExecutedStatus(text(row, cm, "status"))) { skipped.push({ reason: notExecuted(text(row, cm, "status")), detail: `${where} ${String(cell(row, cm, "date") ?? "")}`.trim() }); continue; }
      const date = parseLooseDate(cell(row, cm, "date"));
      const typeRaw = text(row, cm, "type");
      const type = typeRaw ? normaliseType(typeRaw) : "buy";
      if (!date) { skipped.push({ reason: "no date", detail: where }); continue; }
      if (!type) { skipped.push({ reason: `unknown type "${typeRaw}"`, detail: `${where} ${date}` }); continue; }
      let units = Math.abs(parseNumber(cell(row, cm, "units")) ?? 0);
      let price = Math.abs(parseNumber(cell(row, cm, "price")) ?? 0);
      let amount = Math.abs(parseNumber(cell(row, cm, "amount")) ?? 0);
      const fees = Math.abs(parseNumber(cell(row, cm, "fees")) ?? 0);
      if (type === "dividend_payout") { units = 0; price = 0; if (!amount) { skipped.push({ reason: "dividend without amount", detail: `${where} ${date}` }); continue; } }
      else if (type === "bonus" || type === "split") { amount = 0; price = 0; if (!units) { skipped.push({ reason: `${type} without units/ratio`, detail: `${where} ${date}` }); continue; } }
      else {
        if (!price && units && amount) price = amount / units;
        if (!units && price && amount) units = amount / price;
        if (!amount && units && price) amount = units * price;
        if (!units || !price) { skipped.push({ reason: "need two of units, price, amount", detail: `${where} ${date}` }); continue; }
      }
      const isin = /^IN[A-Z0-9]{10}$/.test(isinRaw) ? isinRaw : null;
      const amfiCode = /^\d{3,7}$/.test(amfiRaw) ? amfiRaw : null;
      const symbol = symRaw.replace(/-(EQ|BE)$/, "").replace(/\s+/g, "") || null;
      const isMf = !!amfiCode || isin?.startsWith("INF") || (!symbol && /\bfund\b|\bplan\b|growth|idcw/i.test(name));
      const platform = text(row, cm, "platform") || platformDefault;
      const accountRef = text(row, cm, "account") || platform;
      rows.push({
        assetHint: isMf && !/\betf\b|bees/i.test(name) ? "mf" : "unknown", isin, amfiCode, symbol: isMf ? null : symbol, name: name || symbol || isin || amfiCode!,
        date, type, units, price, amount, fees,
        account: { kind: isMf ? "folio" : "demat", provider: platform.slice(0, 60), ref: accountRef.slice(0, 80) },
        dedupKey: dedup(["sheet", accountRef, amfiCode ?? isin ?? symbol ?? name.toLowerCase(), date, type, units, amount], seen),
      });
    }
    break;
  }
  const st = statusSummary(skipped);
  if (st) warnings.push(st);
  if (!cm) warnings.push("Couldn't find a header row with a date, a name/symbol/ISIN, and units or amount. Download the template to see the expected columns.");
  else if (!rows.length && !skipped.length) warnings.push("The header was found but no rows under it. Check the right sheet is first.");
  return { source: "spreadsheet", filename, rows, skipped, warnings, columns: cm ? { headers: cm.headers, map: cm.map, sheet } : null };
}

export const TXN_TEMPLATE = [
  "date,type,name,symbol,isin,amfi_code,units,price,amount,charges,folio,platform",
  "2024-04-05,SIP,Parag Parikh Flexi Cap Fund - Direct Plan - Growth,,INF879O01027,122639,68.123,73.39,5000,0.25,12345678,Coin",
  "2024-06-12,Buy,Infosys Ltd,INFY,INE009A01021,,10,1520.5,,20,AB1234,Zerodha",
  "2025-01-20,Sell,Infosys Ltd,INFY,INE009A01021,,4,1890,,18,AB1234,Zerodha",
  "2025-03-10,Dividend,Infosys Ltd,INFY,INE009A01021,,,,180,,AB1234,Zerodha",
].join("\n");
