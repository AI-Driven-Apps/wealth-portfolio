/** Parser for AMFI's daily NAVAll.txt (https://www.amfiindia.com/spages/NAVAll.txt). */

// amfiindia.com now 302-redirects here; fetch the portal host directly.
export const AMFI_NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

export type Underlying =
  | "equity" | "debt" | "hybrid" | "gold" | "silver" | "international" | "liquid" | "other";

export interface AmfiScheme {
  amfiCode: string;
  isinGrowth: string | null;
  isinReinvest: string | null;
  name: string;
  amc: string | null;
  category: string | null;      // e.g. "Equity Scheme - Large Cap Fund"
  nav: number | null;
  navDate: string | null;       // yyyy-mm-dd
  isEtf: boolean;
  isFof: boolean;
  underlying: Underlying;
  capClass: "large" | "mid" | "small" | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "16-Oct-2026" → "2026-10-16" */
export function parseAmfiDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

const cleanIsin = (s: string) => (/^IN[A-Z0-9]{10}$/.test(s.trim()) ? s.trim() : null);

/** Classify what a scheme actually holds from its SEBI category and name. */
export function classifyScheme(category: string | null, name: string) {
  const c = (category ?? "").toLowerCase();
  const n = name.toLowerCase();
  const isEtf = /\betf\b/.test(c) || /\betf\b|bees\b/.test(n);
  const isFof = /fof|fund of fund/.test(c) || /\bfof\b|fund of fund/.test(n);
  let underlying: Underlying = "other";
  if (/gold/.test(c) || /\bgold\b/.test(n)) underlying = "gold";
  else if (/silver/.test(c) || /\bsilver\b/.test(n)) underlying = "silver";
  else if (/overseas|international|global|nasdaq|s&p 500|us equity/.test(c + " " + n)) underlying = "international";
  else if (/liquid|overnight|money market/.test(c)) underlying = "liquid";
  else if (/debt scheme|gilt|bond|income/.test(c)) underlying = "debt";
  else if (/hybrid|balanced advantage|arbitrage|multi asset|equity savings/.test(c)) underlying = "hybrid";
  else if (/equity scheme|elss|index fund|other etf|other scheme - index/.test(c)) underlying = "equity";
  else if (/nifty|sensex|equity/.test(n)) underlying = "equity";

  let capClass: AmfiScheme["capClass"] = null;
  if (/large cap fund/.test(c)) capClass = "large";
  else if (/mid cap fund/.test(c)) capClass = "mid";
  else if (/small cap fund/.test(c)) capClass = "small";
  return { isEtf, isFof, underlying, capClass };
}

/**
 * Parses NAVAll.txt. Column positions come from the header row, because AMFI
 * changed the layout in 2026 from 6 columns (name includes plan/option) to 8
 * (Plan and Option as their own columns). Both layouts are supported.
 */
export function parseNavAll(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  let category: string | null = null;
  let amc: string | null = null;
  // default: the old 6-column layout
  let col = { code: 0, isin1: 1, isin2: 2, name: 3, plan: -1, option: -1, nav: 4, date: 5 };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\u00a0/g, " ").trim();
    if (!line) continue;
    if (/^Scheme Code;/i.test(line)) {
      const h = line.split(";").map((x) => x.trim().toLowerCase());
      const find = (re: RegExp, d: number) => { const i = h.findIndex((x) => re.test(x)); return i >= 0 ? i : d; };
      col = {
        code: 0, isin1: find(/growth/, 1), isin2: find(/reinvest/, 2), name: find(/^scheme name/, 3),
        plan: find(/^plan$/, -1), option: find(/^option$/, -1), nav: find(/net asset value/, 4), date: find(/^date$/, 5),
      };
      continue;
    }
    if (!line.includes(";")) {
      const cat = /^[A-Za-z ]*Schemes?\s*\((.+)\)\s*$/i.exec(line);
      if (cat) { category = cat[1].replace(/\s+/g, " ").trim(); amc = null; }
      else amc = line;
      continue;
    }
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 6 || !/^\d+$/.test(parts[col.code])) continue;
    const plan = col.plan >= 0 ? parts[col.plan] : "";
    const option = col.option >= 0 ? parts[col.option] : "";
    // Keep one display name shape for both layouts: "Fund - Direct Plan - Growth Option"
    const name = [parts[col.name], plan, option].filter(Boolean).join(" - ");
    const navNum = Number(parts[col.nav]);
    out.push({
      amfiCode: parts[col.code],
      isinGrowth: cleanIsin(parts[col.isin1] ?? ""),
      isinReinvest: cleanIsin(parts[col.isin2] ?? ""),
      name,
      amc,
      category,
      nav: Number.isFinite(navNum) && navNum > 0 ? navNum : null,
      navDate: parseAmfiDate(parts[col.date] ?? ""),
      ...classifyScheme(category, name),
    });
  }
  return out;
}

/** mfapi.in NAV history response → ascending series. Its dates are dd-mm-yyyy. */
export function parseMfapiHistory(json: unknown): { date: string; close: number }[] {
  const data = (json as { data?: { date: string; nav: string }[] })?.data ?? [];
  const out: { date: string; close: number }[] = [];
  for (const d of data) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d.date);
    const v = Number(d.nav);
    if (m && Number.isFinite(v) && v > 0) out.push({ date: `${m[3]}-${m[2]}-${m[1]}`, close: v });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const MFAPI_BASE = "https://api.mfapi.in/mf";

/** Shared fetch with a timeout and one retry — external feeds are flaky. */
export async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

export async function fetchNavAll(): Promise<AmfiScheme[]> {
  return parseNavAll(await fetchText(AMFI_NAV_URL));
}

/** NAV history from mfapi.in, optionally from a start date (yyyy-mm-dd) to only fetch the gap. */
export async function fetchMfapiHistory(amfiCode: string, startDate?: string) {
  const q = startDate ? `?startDate=${startDate}&endDate=${new Date().toISOString().slice(0, 10)}` : "";
  const json = JSON.parse(await fetchText(`${MFAPI_BASE}/${encodeURIComponent(amfiCode)}${q}`));
  return parseMfapiHistory(json);
}

/** Which index an ETF / index fund tracks, from its name. Used for tracking difference. */
export const INDEX_BENCHMARKS: { re: RegExp; index: string; yahoo: string }[] = [
  { re: /nifty\s*next\s*50|junior\s*bees/i, index: "Nifty Next 50", yahoo: "^NSMIDCP" },
  { re: /nifty\s*bank|bank\s*bees|banking\s*etf/i, index: "Nifty Bank", yahoo: "^NSEBANK" },
  { re: /nifty\s*it\b|it\s*bees/i, index: "Nifty IT", yahoo: "^CNXIT" },
  { re: /nifty\s*midcap\s*150|midcap\s*150/i, index: "Nifty Midcap 150", yahoo: "NIFTYMIDCAP150.NS" },
  { re: /nifty\s*500/i, index: "Nifty 500", yahoo: "^CRSLDX" },
  { re: /sensex/i, index: "S&P BSE Sensex", yahoo: "^BSESN" },
  { re: /nifty\s*50\b|nifty\s*bees|nifty\s*etf/i, index: "Nifty 50", yahoo: "^NSEI" },
];

export function detectTrackedIndex(name: string) {
  return INDEX_BENCHMARKS.find((b) => b.re.test(name)) ?? null;
}
