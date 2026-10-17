import { normHeader, parseNumber } from "@/lib/import/tabular";

// Monthly portfolio disclosures (SEBI requires every AMC to publish one within
// ~10 days of month end). Parsers are a small registry: the generic one reads
// any sheet with a name column and a "% to NAV"-style column, which covers a
// plain CSV and most AMC Excel layouts. AMC-specific parsers go in front of it
// in PARSERS when a layout needs special handling.

export type HoldingKind = "equity" | "foreign_equity" | "debt" | "fund" | "cash" | "other";

export interface DisclosureRow {
  name: string;
  isin: string | null;
  kind: HoldingKind;
  sector: string | null;
  weightPct: number;
}

export interface DisclosureParser {
  id: string;
  label: string;
  /** Rows, or null when the sheet isn't this parser's layout. */
  parse(grid: unknown[][]): DisclosureRow[] | null;
}

const RATING_RE = /\b(sov|sovereign|aaa|aa[+-]?|a1\+?|a[+-]|bbb[+-]?|crisil|icra|care|fitch|ind ?a|brickwork|bwr|acuite|unrated)\b/i;
const CASH_RE = /\b(treps|cblo|reverse repo|tri-?party repo|net receivables?|net current assets?|cash( and| &)? cash equivalents?|cash|margin money|clearing corporation)\b/i;
const DEBT_NAME_RE = /\b(bonds?|debentures?|ncds?|treasury|t-?bills?|gilt|sdl|goi|government of india|commercial paper|certificate of deposit|state development loan)\b/i;

const isIsin = (s: string) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s);

/**
 * What a disclosure line is. Indian ISINs encode it: INF = mutual fund units,
 * INE + 4-char issuer + "01" = equity shares, IN9 = partly paid shares,
 * IN0–IN4 = government securities, other INE codes = debentures/CP/CDs.
 */
export function classifyHolding(isin: string | null, name: string, typeHint = "", industry = ""): HoldingKind {
  const h = typeHint.toLowerCase();
  if (h) {
    if (/cash|treps|repo/.test(h)) return "cash";
    if (/fund|mutual|etf|units|fof/.test(h)) return "fund";
    if (/debt|bond|g-?sec|gilt|t-?bill|money market|ncd|cp|cd/.test(h)) return "debt";
    if (/foreign|international|overseas|global/.test(h)) return "foreign_equity";
    if (/equity|stock|share/.test(h)) return isin && !isin.startsWith("IN") ? "foreign_equity" : "equity";
  }
  if (CASH_RE.test(name) && !isin?.startsWith("INE")) return "cash";
  if (isin) {
    if (isin.startsWith("INF")) return "fund";
    if (/^INE[A-Z0-9]{4}01/.test(isin) || isin.startsWith("IN9")) return "equity";
    if (/^IN[0-4]/.test(isin) || isin.startsWith("INE")) return "debt";
    if (!isin.startsWith("IN")) return DEBT_NAME_RE.test(name) || RATING_RE.test(industry) ? "debt" : "foreign_equity";
  }
  if (RATING_RE.test(industry) || DEBT_NAME_RE.test(name)) return "debt";
  return "other";
}

const SKIP_ROW = /^(sub[\s-]*total|total|grand total|net assets|portfolio total|\(a\)|\(b\))\b/i;

function findCols(h: string[]) {
  const idx = (pred: (x: string) => boolean) => h.findIndex(pred);
  const name = idx((x) => ["nameoftheinstrument", "nameofinstrument", "nameoftheinstrumentissuer", "instrument", "company", "companyname", "security", "securityname", "nameofthesecurity", "name", "issuer", "nameoftheissuer", "scrip", "stock", "holding", "holdingname", "fund", "underlyingfund", "scheme", "schemename"].includes(x) || x.startsWith("nameofthe") || x.startsWith("nameofinstrument"));
  const isin = idx((x) => x === "isin" || x === "isincode" || x === "isinno" || x === "isinnumber");
  const weight = idx((x) => x === "tonav" || x === "ofnav" || x === "percentagetonav" || x === "pctnav" || x === "navpct" || x.includes("netasset") || x.endsWith("tonav") || x === "weight" || x === "weightage" || x === "weightpct" || x === "allocation" || x === "allocationpct" || x === "pct" || x === "percent" || x === "percentage");
  const industry = idx((x) => x === "industry" || x === "sector" || x === "industryrating" || x === "ratingindustry" || x === "rating" || x.startsWith("industry") || x === "sectorrating");
  const type = idx((x) => x === "type" || x === "assettype" || x === "kind" || x === "assetclass" || x === "instrumenttype" || x === "securitytype");
  return { name, isin, weight, industry, type };
}

export const genericParser: DisclosureParser = {
  id: "generic",
  label: "Generic (name + % to NAV columns)",
  parse(grid) {
    for (let r = 0; r < Math.min(grid.length, 40); r++) {
      const c = findCols((grid[r] ?? []).map((x) => normHeader(String(x ?? ""))));
      if (c.name < 0 || c.weight < 0) continue;
      const out: DisclosureRow[] = [];
      for (const row of grid.slice(r + 1)) {
        const name = String(row[c.name] ?? "").replace(/\s+/g, " ").trim();
        if (!name || SKIP_ROW.test(name)) continue;
        const w = parseNumber(String(row[c.weight] ?? "").replace("%", ""));
        if (w == null || w === 0) continue;
        const rawIsin = c.isin >= 0 ? String(row[c.isin] ?? "").trim().toUpperCase() : "";
        const isin = isIsin(rawIsin) ? rawIsin : null;
        const industry = c.industry >= 0 ? String(row[c.industry] ?? "").trim() : "";
        const kind = classifyHolding(isin, name, c.type >= 0 ? String(row[c.type] ?? "") : "", industry);
        const sector = (kind === "equity" || kind === "foreign_equity") && industry && !RATING_RE.test(industry) ? industry : null;
        out.push({ name, isin, kind, sector, weightPct: w });
      }
      if (!out.length) continue;
      // Some files give weights as fractions (0.0853) instead of percent (8.53).
      const pos = out.filter((x) => x.weightPct > 0);
      const sum = pos.reduce((s, x) => s + x.weightPct, 0);
      if (sum > 0 && sum <= 1.5 && Math.max(...pos.map((x) => x.weightPct)) <= 1) for (const x of out) x.weightPct *= 100;
      return out;
    }
    return null;
  },
};

/** AMC-specific parsers go first; the generic one is the fallback. */
export const PARSERS: DisclosureParser[] = [genericParser];

export interface ParsedDisclosure {
  parser: string;
  rows: DisclosureRow[];
  /** Sum of positive weights, in percent. */
  totalPct: number;
  warnings: string[];
}

export function parseDisclosure(grid: unknown[][]): ParsedDisclosure | null {
  for (const p of PARSERS) {
    const raw = p.parse(grid);
    if (!raw?.length) continue;
    // Same security on two lines (e.g. split across sub-sections): merge.
    const merged = new Map<string, DisclosureRow>();
    for (const r of raw) {
      const k = r.isin ?? `${r.kind}:${r.name.toLowerCase()}`;
      const ex = merged.get(k);
      if (ex) ex.weightPct += r.weightPct; else merged.set(k, { ...r });
    }
    const rows = [...merged.values()];
    const totalPct = rows.filter((r) => r.weightPct > 0).reduce((s, r) => s + r.weightPct, 0);
    const warnings: string[] = [];
    if (totalPct < 90) warnings.push(`Weights add up to ${totalPct.toFixed(1)}%; the rest is shown as "not itemised".`);
    if (totalPct > 110) warnings.push(`Weights add up to ${totalPct.toFixed(1)}% (derivatives or leverage?); they are scaled down to 100%.`);
    const negatives = rows.filter((r) => r.weightPct < 0).length;
    if (negatives) warnings.push(`${negatives} line${negatives > 1 ? "s" : ""} with negative weight (hedges, net payables) ignored.`);
    return { parser: p.id, rows, totalPct, warnings };
  }
  return null;
}

/** For a multi-scheme AMC workbook: the sheet whose first rows mention the fund's name best. */
export function pickSheet<T extends { name: string; grid: unknown[][] }>(sheets: T[], fundName: string): T | null {
  if (sheets.length <= 1) return sheets[0] ?? null;
  const stop = new Set(["fund", "plan", "direct", "regular", "growth", "option", "the", "of", "idcw", "scheme", "mutual"]);
  const tokens = fundName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !stop.has(t));
  let best: T | null = null, bestScore = 0;
  for (const s of sheets) {
    const text = (s.name + " " + s.grid.slice(0, 8).flat().map((c) => String(c ?? "")).join(" ")).toLowerCase();
    const score = tokens.filter((t) => text.includes(t)).length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

/** "Portfolio as on 30-Sep-2026" style titles → "2026-09-01". */
export function detectAsOfMonth(grid: unknown[][]): string | null {
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (const row of grid.slice(0, 10)) {
    for (const cell of row) {
      const s = String(cell ?? "");
      if (!/as (on|at|of)|portfolio|statement/i.test(s)) continue;
      let m = /(\d{1,2})[-\s/.]([A-Za-z]{3})[a-z]*[-\s/.,]+(\d{4})/.exec(s);
      if (m && months.includes(m[2].toLowerCase())) return `${m[3]}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-01`;
      m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
      if (m) return `${m[3]}-${m[2].padStart(2, "0")}-01`;
      m = /([A-Za-z]{3})[a-z]*[\s,-]+(\d{4})/.exec(s);
      if (m && months.includes(m[1].toLowerCase())) return `${m[2]}-${String(months.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-01`;
    }
  }
  return null;
}
