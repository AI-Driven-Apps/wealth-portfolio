// End-of-day prices from NSE's own archives: one bhavcopy per trading day with
// every security on the cash market (equities, ETFs, InvITs, REITs, gold bonds),
// keyed by ISIN, plus one file of index closes. Static files, no API key, and not
// subject to Yahoo's rate limiting. Raw closes only (no adjustment for splits or
// dividends), which is what holdings are valued at.
import { inflateRawSync } from "node:zlib";
import { parseCsv } from "@/lib/import/tabular";

const UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** First day of the UDiFF bhavcopy; earlier days are in the legacy archive. */
export const UDIFF_FROM = "2024-07-08";

export interface BhavRow { symbol: string; isin: string; series: string; close: number }

export function bhavUrl(date: string): string {
  const [y, m, d] = date.split("-");
  return date >= UDIFF_FROM
    ? `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${y}${m}${d}_F_0000.csv.zip`
    : `https://nsearchives.nseindia.com/content/historical/EQUITIES/${y}/${MON[Number(m) - 1]}/cm${d}${MON[Number(m) - 1]}${y}bhav.csv.zip`;
}

export function indexUrl(date: string): string {
  const [y, m, d] = date.split("-");
  return `https://nsearchives.nseindia.com/content/indices/ind_close_all_${d}${m}${y}.csv`;
}

/** null = no file for that day (holiday, or not published yet). */
async function get(url: string): Promise<Uint8Array | null> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (res.status === 404 || res.status === 403) return null; // NSE answers 403 for some missing archive days
      if (!res.ok) throw new Error(`NSE archive HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw last;
}

/** The first file in a zip archive (bhavcopies hold exactly one CSV). */
export function unzipFirst(buf: Uint8Array): string {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Sizes come from the central directory: the local header may defer them to a data descriptor.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const cd = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error("bad zip directory");
  const method = dv.getUint16(cd + 10, true), size = dv.getUint32(cd + 20, true), local = dv.getUint32(cd + 42, true);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  const data = buf.subarray(start, start + size);
  const out = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
  if (!out) throw new Error(`zip method ${method} not supported`);
  return new TextDecoder().decode(out);
}

/** Both layouts: UDiFF (TckrSymb, ISIN, SctySrs, ClsPric) and legacy (SYMBOL, SERIES, CLOSE, ISIN). */
export function parseBhav(csv: string): BhavRow[] {
  const [head, ...rows] = parseCsv(csv);
  if (!head) return [];
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h.trim().toUpperCase()));
  const sym = col("TCKRSYMB", "SYMBOL"), isin = col("ISIN"), ser = col("SCTYSRS", "SERIES"), close = col("CLSPRIC", "CLOSE");
  if (sym < 0 || isin < 0 || close < 0) throw new Error("unrecognised bhavcopy layout");
  const out: BhavRow[] = [];
  for (const r of rows) {
    const c = Number(r[close]);
    if (!(c > 0) || !r[isin]?.trim()) continue;
    out.push({ symbol: r[sym].trim().toUpperCase(), isin: r[isin].trim().toUpperCase(), series: (r[ser] ?? "").trim().toUpperCase(), close: c });
  }
  return out;
}

export async function fetchBhav(date: string): Promise<BhavRow[] | null> {
  const zip = await get(bhavUrl(date));
  return zip ? parseBhav(unzipFirst(zip)) : null;
}

/** Index closes for a day, keyed by lower-cased index name ("nifty 50"). */
export async function fetchIndexCloses(date: string): Promise<Map<string, number> | null> {
  const body = await get(indexUrl(date));
  if (!body) return null;
  const [head, ...rows] = parseCsv(new TextDecoder().decode(body));
  const name = head?.findIndex((h) => /index name/i.test(h)) ?? -1, close = head?.findIndex((h) => /closing index value/i.test(h)) ?? -1;
  const out = new Map<string, number>();
  if (name < 0 || close < 0) return out;
  for (const r of rows) { const v = Number(r[close]); if (v > 0) out.set(r[name].trim().toLowerCase(), v); }
  return out;
}

/** Equity-like series, best first: one ISIN can trade in several (EQ and BE, say). */
export const SERIES_RANK = ["EQ", "BE", "BZ", "SM", "ST", "IV", "RR", "GB", "GS"];
