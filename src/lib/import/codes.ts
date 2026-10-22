// Broker code lists: some brokers' tradebooks carry their own instrument code
// (HDFC Securities "3MINDLEQNR", ICICI Direct "INFTEC") instead of an NSE symbol
// or ISIN. A code list (from the broker, as CSV/XLSX or a PDF table) maps each code
// to an ISIN, or to an NSE symbol; the import then resolves codes through it.
import { normHeader } from "./tabular";

/** "HDFC Securities", "HDFC Sec Ltd", "hdfc" → "hdfc": the scope codes are saved under. */
export function brokerKey(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, "")
    .replace(/(securities|security|sec|broking|brokers|stockbroking|direct|ltd|limited|pvt|private|india)+$/, "");
  return k || "broker";
}

// Columns by preference: the first name found wins, whatever the column order.
// A broker's own code column (HDFC "InternalCode" / "Scrip_ID") is the code; a
// plain "Symbol" column is then the NSE symbol. Only a list with no code column of
// its own (code -> ISIN keyed by symbol) uses "Symbol" as the code.
const CODE = ["internalcode", "brokerinternalcode", "brokercode", "scripid", "scripcode", "hslcode", "stockcode", "securitycode", "securityid", "scripsymbol", "scrip", "code"];
const CODE_FALLBACK = ["symbol", "tradingsymbol"];
const NSE = ["nsesymbol", "nsecode", "nsescrip", "symbol", "tradingsymbol"];
const ISIN = ["isin", "isincode", "isinno", "isinnumber"];
const NAME = ["securityname", "name", "companyname", "stockname", "scripname", "security", "description"];

export interface CodeEntry { code: string; isin: string | null; nseSymbol: string | null; name: string | null }

function findColumns(grid: unknown[][]) {
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const cells = (grid[r] ?? []).map((c) => normHeader(String(c ?? "")));
    const pick = (names: string[], taken: (number | undefined)[] = []) =>
      names.map((n) => cells.indexOf(n)).find((i) => i >= 0 && !taken.includes(i));
    const code = pick(CODE) ?? pick(CODE_FALLBACK);
    const isin = pick(ISIN);
    const nse = pick(NSE, [code]);
    const name = pick(NAME, [code, nse]);
    if (code !== undefined && (isin !== undefined || nse !== undefined)) return { headerRow: r, code, isin, nse, name };
  }
  return null;
}

export function parseCodeList(grid: unknown[][]): { entries: CodeEntry[]; skipped: number; found: boolean } {
  const cm = findColumns(grid);
  if (!cm) return { entries: [], skipped: 0, found: false };
  const cell = (row: unknown[], i: number | undefined) => (i === undefined ? "" : String(row[i] ?? "").trim());
  const header = cell(grid[cm.headerRow], cm.code).toUpperCase().replace(/\s+/g, "");
  const byCode = new Map<string, CodeEntry>();
  let skipped = 0;
  for (const row of grid.slice(cm.headerRow + 1)) {
    const code = cell(row, cm.code).toUpperCase().replace(/\s+/g, "");
    const isinRaw = cell(row, cm.isin).toUpperCase().replace(/\s+/g, "");
    const nse = cell(row, cm.nse).toUpperCase().replace(/\s+/g, "").replace(/-(EQ|BE)$/, "");
    const isin = /^IN[A-Z0-9]{10}$/.test(isinRaw) ? isinRaw : null;
    // a repeated header row (each PDF page) or a note line
    if (!code || (!isin && !nse) || code === header) { if (code || isinRaw) skipped++; continue; }
    byCode.set(code, { code: code.slice(0, 40), isin, nseSymbol: nse.slice(0, 40) || null, name: cell(row, cm.name).replace(/\s+/g, " ").slice(0, 200) || null });
  }
  return { entries: [...byCode.values()], skipped, found: true };
}
