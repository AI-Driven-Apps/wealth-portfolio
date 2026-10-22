// Broker tradebooks (XLS / XLSX / CSV). Columns are matched by header aliases, so
// Zerodha, Dhan, Groww, Upstox, ICICI and most other exports work without a
// per-broker template. Header row may sit below a few title rows.
import * as XLSX from "@e965/xlsx";
import { normHeader, parseLooseDate, parseNumber } from "./tabular";
import { dedup, type ImportPreview, type ImportRow } from "./types";
import { STATUS_ALIASES, isExecutedStatus, notExecuted, statusSummary } from "./status";

// Listed in order of preference: when a file has several matching columns, the
// earlier alias wins (an exchange symbol or broker code over a company name).
const ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "tradingsymbol", "internalcode", "scripid", "scripcode", "scrip", "scripsymbol", "stock", "scripname", "stockname", "securityname", "security", "instrument", "name", "companyname"],
  name: ["securityname", "stockname", "companyname", "scripname", "name", "security"],
  status: STATUS_ALIASES,
  isin: ["isin", "isincode"],
  date: ["tradedate", "date", "orderexecutiontime", "executiontime", "tradetime", "transactiondate", "orderdate", "datetime"],
  side: ["tradetype", "type", "buysell", "side", "transactiontype", "action", "buyorsell", "bs", "ordertype"],
  // Order logs (HDFC Securities' "trade log") have both: what was ordered and what filled.
  filled: ["executionqty", "executedqty", "execqty", "executedquantity", "executionquantity", "filledqty", "filledquantity", "tradedqty", "tradedquantity"],
  qty: ["quantity", "qty", "shares", "units", "orderqty", "orderquantity"],
  // order (limit) price last: only an order log without a fill price uses it
  price: ["price", "tradeprice", "rate", "avgprice", "averageprice", "tradedprice", "executionprice", "execprice", "avgexecutionprice", "marketrate", "orderprice", "limitprice"],
  value: ["value", "tradevalue", "amount", "netamount", "totalvalue", "turnover"],
  exchange: ["exchange", "exch", "exchangesegment"],
  segment: ["segment", "series", "instrumenttype", "product"],
  tradeId: ["tradeid", "tradeno", "tradenumber", "exchangetradeid", "exchtradeno", "orderid", "orderno", "ordernumber", "exchorderno", "exchangeorderno", "hslrefno"],
  reason: ["reason", "rejectionreason", "statusreason", "remarks"],
  fees: ["charges", "totalcharges", "brokerage", "fees"],
};

function findHeader(rows: unknown[][]): { idx: number; map: Record<string, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const cells = rows[r].map((c) => normHeader(String(c ?? "")));
    const map: Record<string, number> = {};
    for (const [field, names] of Object.entries(ALIASES)) {
      const i = names.map((n) => cells.indexOf(n)).find((j) => j >= 0);
      if (i !== undefined) map[field] = i;
    }
    // a name column only adds something when it isn't the column read as the symbol
    if (map.name === map.symbol) delete map.name;
    if ((map.symbol ?? map.isin) !== undefined && map.date !== undefined && map.side !== undefined && (map.qty ?? map.filled) !== undefined && (map.price !== undefined || map.value !== undefined)) {
      return { idx: r, map };
    }
  }
  return null;
}

export function parseTradebook(buf: ArrayBuffer | Uint8Array, filename: string, broker: string, accountRef: string): ImportPreview {
  // No JS Date objects: SheetJS builds them at local midnight, which shifts the
  // trade date by a day depending on the server's timezone. CSV cells stay text
  // (raw) and Excel dates stay serial numbers; parseLooseDate handles both without TZ.
  const isCsv = /\.csv$/i.test(filename);
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: isCsv });
  const rows: ImportRow[] = [];
  const skipped: ImportPreview["skipped"] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  let found = false, usedOrderPrice = false;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    const h = findHeader(grid);
    if (!h) continue;
    found = true;
    const priceHeader = normHeader(String(grid[h.idx][h.map.price ?? -1] ?? ""));
    if (priceHeader === "orderprice" || priceHeader === "limitprice") usedOrderPrice = true;
    const get = (row: unknown[], f: string) => (h.map[f] === undefined ? null : row[h.map[f]]);
    for (const row of grid.slice(h.idx + 1)) {
      const sideRaw = String(get(row, "side") ?? "").trim().toLowerCase();
      const side = /^(b|buy|purchase)/.test(sideRaw) ? "buy" : /^(s|sell|sale)/.test(sideRaw) ? "sell" : null;
      const date = parseLooseDate(get(row, "date"));
      const ordered = Math.abs(parseNumber(get(row, "qty")) ?? 0);
      const hasFilled = h.map.filled !== undefined;
      const qty = hasFilled ? Math.abs(parseNumber(get(row, "filled")) ?? 0) : ordered;
      let price = parseNumber(get(row, "price"));
      const value = parseNumber(get(row, "value"));
      if (!price && value && qty) price = Math.abs(value) / qty;
      const seg = String(get(row, "segment") ?? "").toUpperCase();
      const symRaw = String(get(row, "symbol") ?? "").trim();
      if (!symRaw && !get(row, "isin")) continue; // footer / blank line
      let note: string | undefined;
      if (h.map.status !== undefined) {
        const st = String(get(row, "status") ?? "").trim();
        const why = String(get(row, "reason") ?? "").replace(/\s+/g, " ").trim();
        const detail = `${symRaw} ${String(get(row, "date") ?? "")} ${sideRaw}${why ? ` · ${why}` : ""}`.trim();
        // With an executed-quantity column, that quantity is the truth: an order that
        // filled 4 of 10 and then expired still bought 4. Without one, the status decides.
        if (hasFilled ? !qty : !isExecutedStatus(st)) { skipped.push({ reason: notExecuted(st), detail }); continue; }
        if (!isExecutedStatus(st)) note = `${qty} of ${ordered || "?"} executed; order status "${st}"`;
      }
      if (/\b(FUT|CE|PE|OPT|FO|NFO|MCX|CDS)\b/.test(seg) || /\d{2}[A-Z]{3}\d*(CE|PE|FUT)$/.test(symRaw.toUpperCase())) {
        skipped.push({ reason: "derivative", detail: `${symRaw} ${seg}` }); continue;
      }
      if (side && date && qty && !price) { skipped.push({ reason: "no execution price", detail: `${symRaw} ${date} ${side} ${qty}${String(get(row, "status") ?? "") ? ` · ${String(get(row, "status"))}` : ""}` }); continue; }
      if (!side || !date || !qty || !price) { skipped.push({ reason: "incomplete row", detail: row.filter((c) => c != null).join(" | ").slice(0, 120) }); continue; }
      const isinRaw = String(get(row, "isin") ?? "").trim().toUpperCase();
      const isin = /^IN[A-Z0-9]{10}$/.test(isinRaw) ? isinRaw : null;
      const symbol = symRaw.toUpperCase().replace(/-(EQ|BE|BZ|SM|ST)$/, "").replace(/\s+/g, "") || null;
      const fees = Math.abs(parseNumber(get(row, "fees")) ?? 0);
      const nameRaw = String(get(row, "name") ?? "").replace(/\s+/g, " ").trim();
      const tradeId = String(get(row, "tradeId") ?? "").trim();
      rows.push({
        assetHint: "unknown", isin, amfiCode: null, symbol, name: nameRaw || symRaw || isin || "",
        date, type: side, units: qty, price, amount: qty * price, fees, note,
        account: { kind: "demat", provider: broker, ref: accountRef },
        // Same key shape as contract notes, so one trade imported from both is saved once.
        dedupKey: dedup(tradeId ? ["trade", broker.toLowerCase(), tradeId] : ["trade", broker.toLowerCase(), isin ?? symbol, date, side, qty, price], seen),
      });
    }
  }
  const st = statusSummary(skipped);
  if (st) warnings.push(st);
  if (usedOrderPrice && rows.length) warnings.push("This file is an order log: prices are the order (limit) price, and a limit order can fill at a better one. Market orders carry no price and are listed as skipped (\"no execution price\"). Import the contract notes for those dates for exact prices and charges.");
  if (!found) warnings.push("Couldn't find a header row with symbol/ISIN, date, buy/sell, quantity and price columns. Check the file is a tradebook, not a P&L or holdings report.");
  if (rows.length && !rows.some((r) => r.fees)) warnings.push("Tradebooks don't include brokerage and statutory charges, so costs here exclude them. Import contract notes instead if you want charges in your cost.");
  return { source: "tradebook", filename, rows, skipped, warnings, meta: { broker } };
}
