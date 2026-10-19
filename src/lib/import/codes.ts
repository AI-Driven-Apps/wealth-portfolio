// Broker code lists: some brokers' tradebooks carry their own instrument code
// (HDFC Securities "3MINDLEQNR", ICICI Direct "INFTEC") instead of an NSE symbol
// or ISIN. A code list (from the broker, as CSV/XLSX or a PDF table) maps each code
// to an ISIN, or to an NSE symbol; the import then resolves codes through it.
import { detectColumns, text, type Aliases } from "./columns";

/** "HDFC Securities", "HDFC Sec Ltd", "hdfc" → "hdfc": the scope codes are saved under. */
export function brokerKey(name: string): string {
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, "")
    .replace(/(securities|security|sec|broking|brokers|stockbroking|direct|ltd|limited|pvt|private|india)+$/, "");
  return k || "broker";
}

const ALIASES: Aliases = {
  code: ["scripid", "scripcode", "scrip", "scripsymbol", "securitycode", "securityid", "stockcode", "brokercode", "code", "symbol", "tradingsymbol"],
  isin: ["isin", "isincode", "isinno", "isinnumber"],
  nse: ["nsesymbol", "nsecode", "nsescrip"],
  name: ["securityname", "name", "companyname", "stockname", "scripname", "security", "description"],
};

export interface CodeEntry { code: string; isin: string | null; nseSymbol: string | null; name: string | null }

export function parseCodeList(grid: unknown[][]): { entries: CodeEntry[]; skipped: number; found: boolean } {
  const cm = detectColumns(grid, ALIASES, [["code"], ["isin", "nse"]]);
  if (!cm) return { entries: [], skipped: 0, found: false };
  const byCode = new Map<string, CodeEntry>();
  let skipped = 0;
  for (const row of grid.slice(cm.headerRow + 1)) {
    const code = text(row, cm, "code").toUpperCase().replace(/\s+/g, "");
    const isinRaw = text(row, cm, "isin").toUpperCase().replace(/\s+/g, "");
    const nse = text(row, cm, "nse").toUpperCase().replace(/\s+/g, "").replace(/-(EQ|BE)$/, "");
    const isin = /^IN[A-Z0-9]{10}$/.test(isinRaw) ? isinRaw : null;
    // a repeated header row (each PDF page) or a note line
    if (!code || (!isin && !nse) || code === text(cm.headers, cm, "code").toUpperCase().replace(/\s+/g, "")) { if (code || isinRaw) skipped++; continue; }
    byCode.set(code, { code: code.slice(0, 40), isin, nseSymbol: isin ? null : nse.slice(0, 40), name: text(row, cm, "name").replace(/\s+/g, " ").slice(0, 200) || null });
  }
  return { entries: [...byCode.values()], skipped, found: true };
}
