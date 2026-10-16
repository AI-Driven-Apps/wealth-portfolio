// Broker tradebooks (XLS / XLSX / CSV). Columns are matched by header aliases, so
// Zerodha, Dhan, Groww, Upstox, ICICI and most other exports work without a
// per-broker template. Header row may sit below a few title rows.
import * as XLSX from "xlsx";
import { normHeader, parseLooseDate, parseNumber } from "./tabular";
import { dedup, type ImportPreview, type ImportRow } from "./types";

const ALIASES: Record<string, string[]> = {
  symbol: ["symbol", "tradingsymbol", "scrip", "scripname", "scripcode", "stock", "stockname", "securityname", "security", "instrument", "name", "companyname"],
  isin: ["isin", "isincode"],
  date: ["tradedate", "date", "orderexecutiontime", "executiontime", "tradetime", "transactiondate", "orderdate", "datetime"],
  side: ["tradetype", "type", "buysell", "side", "transactiontype", "action", "buyorsell", "bs", "ordertype"],
  qty: ["quantity", "qty", "tradedqty", "tradedquantity", "filledqty", "shares", "units"],
  price: ["price", "tradeprice", "rate", "avgprice", "averageprice", "tradedprice", "executionprice", "marketrate"],
  value: ["value", "tradevalue", "amount", "netamount", "totalvalue", "turnover"],
  exchange: ["exchange", "exch", "exchangesegment"],
  segment: ["segment", "series", "instrumenttype", "product"],
  tradeId: ["tradeid", "tradeno", "tradenumber", "orderid", "orderno", "ordernumber", "exchangetradeid"],
  fees: ["charges", "totalcharges", "brokerage", "fees"],
};

function findHeader(rows: unknown[][]): { idx: number; map: Record<string, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const cells = rows[r].map((c) => normHeader(String(c ?? "")));
    const map: Record<string, number> = {};
    for (const [field, names] of Object.entries(ALIASES)) {
      const i = cells.findIndex((c) => names.includes(c));
      if (i >= 0) map[field] = i;
    }
    if ((map.symbol ?? map.isin) !== undefined && map.date !== undefined && map.side !== undefined && map.qty !== undefined && (map.price !== undefined || map.value !== undefined)) {
      return { idx: r, map };
    }
  }
  return null;
}

export function parseTradebook(buf: ArrayBuffer | Uint8Array, filename: string, broker: string, accountRef: string): ImportPreview {
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false });
  const rows: ImportRow[] = [];
  const skipped: ImportPreview["skipped"] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  let found = false;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    const h = findHeader(grid);
    if (!h) continue;
    found = true;
    const get = (row: unknown[], f: string) => (h.map[f] === undefined ? null : row[h.map[f]]);
    for (const row of grid.slice(h.idx + 1)) {
      const sideRaw = String(get(row, "side") ?? "").trim().toLowerCase();
      const side = /^(b|buy|purchase)/.test(sideRaw) ? "buy" : /^(s|sell|sale)/.test(sideRaw) ? "sell" : null;
      const date = parseLooseDate(get(row, "date"));
      const qty = Math.abs(parseNumber(get(row, "qty")) ?? 0);
      let price = parseNumber(get(row, "price"));
      const value = parseNumber(get(row, "value"));
      if (!price && value && qty) price = Math.abs(value) / qty;
      const seg = String(get(row, "segment") ?? "").toUpperCase();
      const symRaw = String(get(row, "symbol") ?? "").trim();
      if (!symRaw && !get(row, "isin")) continue; // footer / blank line
      if (/\b(FUT|CE|PE|OPT|FO|NFO|MCX|CDS)\b/.test(seg) || /\d{2}[A-Z]{3}\d*(CE|PE|FUT)$/.test(symRaw.toUpperCase())) {
        skipped.push({ reason: "derivative", detail: `${symRaw} ${seg}` }); continue;
      }
      if (!side || !date || !qty || !price) { skipped.push({ reason: "incomplete row", detail: row.filter((c) => c != null).join(" | ").slice(0, 120) }); continue; }
      const isinRaw = String(get(row, "isin") ?? "").trim().toUpperCase();
      const isin = /^IN[A-Z0-9]{10}$/.test(isinRaw) ? isinRaw : null;
      const symbol = symRaw.toUpperCase().replace(/-(EQ|BE|BZ|SM|ST)$/, "").replace(/\s+/g, "") || null;
      const fees = Math.abs(parseNumber(get(row, "fees")) ?? 0);
      const tradeId = String(get(row, "tradeId") ?? "").trim();
      rows.push({
        assetHint: "unknown", isin, amfiCode: null, symbol, name: symRaw || isin || "",
        date, type: side, units: qty, price, amount: qty * price, fees,
        account: { kind: "demat", provider: broker, ref: accountRef },
        // Same key shape as contract notes, so one trade imported from both is saved once.
        dedupKey: dedup(tradeId ? ["trade", broker.toLowerCase(), tradeId] : ["trade", broker.toLowerCase(), isin ?? symbol, date, side, qty, price], seen),
      });
    }
  }
  if (!found) warnings.push("Couldn't find a header row with symbol/ISIN, date, buy/sell, quantity and price columns. Check the file is a tradebook, not a P&L or holdings report.");
  if (rows.length && !rows.some((r) => r.fees)) warnings.push("Tradebooks don't include brokerage and statutory charges, so costs here exclude them. Import contract notes instead if you want charges in your cost.");
  return { source: "tradebook", filename, rows, skipped, warnings, meta: { broker } };
}
