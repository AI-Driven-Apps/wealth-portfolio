import type { HoldingKind } from "./disclosure";

// Look-through: exposure to stock s = your fund value × s's weight in the
// fund's latest disclosure, summed over every fund and ETF, plus the stocks
// you hold directly. A fund line that is itself a fund (FoF → underlying
// scheme) is expanded with that fund's own disclosure, so FoFs resolve two
// (or more) levels deep. Pure: the caller loads the data.

export interface LtPosition {
  instrumentId: number;
  type: "stock" | "mf" | "etf";
  value: number;
  /** Holding-level class (equity / debt / gold...), used when there is no disclosure. */
  assetClass: string;
}

export interface LtLine {
  holdingInstrumentId: number | null;
  name: string;
  isin: string | null;
  kind: HoldingKind;
  sector: string | null;
  weightPct: number;
}

export interface LtDisclosure { asOf: string; lines: LtLine[] }

export interface StockInfo { name: string; capClass: string | null; sector: string | null }

export interface Exposure {
  key: string;
  instrumentId: number | null;
  name: string;
  isin: string | null;
  capClass: string | null;
  sector: string | null;
  foreign: boolean;
  direct: number;
  viaFunds: number;
  /** Top-level holding (fund you own) → rupees of this stock through it. */
  via: Map<number, number>;
}

export interface FundCoverage {
  fundId: number;
  value: number;
  asOf: string | null;
  /** Share of the fund's value itemised by its disclosure (0..1); 0 without one. */
  itemised: number;
  unresolvedFunds: string[];
}

export interface LookThrough {
  exposures: Exposure[];          // equity only, largest first
  classes: Map<string, number>;   // asset classes after look-through
  coverage: FundCoverage[];
  /** Equity held through funds that have no disclosure yet. */
  equityNotLookedThrough: number;
  total: number;
}

const MAX_DEPTH = 3;

export function lookThrough(
  positions: LtPosition[],
  disclosures: Map<number, LtDisclosure>,
  stockInfo: Map<number, StockInfo>,
  fundClass: Map<number, string>,
): LookThrough {
  const exp = new Map<string, Exposure>();
  const classes = new Map<string, number>();
  const coverage: FundCoverage[] = [];
  let equityNotLookedThrough = 0;
  const addClass = (c: string, v: number) => classes.set(c, (classes.get(c) ?? 0) + v);

  const addStock = (l: { instrumentId: number | null; name: string; isin: string | null; sector: string | null; foreign: boolean }, v: number, top: number | null) => {
    const key = l.instrumentId != null ? `i:${l.instrumentId}` : l.isin ? `isin:${l.isin}` : `n:${l.name.toLowerCase()}`;
    const info = l.instrumentId != null ? stockInfo.get(l.instrumentId) : undefined;
    let e = exp.get(key);
    if (!e) {
      e = { key, instrumentId: l.instrumentId, name: info?.name ?? l.name, isin: l.isin, capClass: l.foreign ? null : info?.capClass ?? null, sector: info?.sector ?? l.sector, foreign: l.foreign, direct: 0, viaFunds: 0, via: new Map() };
      exp.set(key, e);
    }
    if (!e.sector && l.sector) e.sector = l.sector;
    if (top == null) e.direct += v;
    else { e.viaFunds += v; e.via.set(top, (e.via.get(top) ?? 0) + v); }
  };

  /** Spreads `value` of fund `fundId` over its lines; returns the itemised share and unresolved fund names. */
  const expand = (fundId: number, value: number, top: number, depth: number, path: Set<number>): { itemised: number; unresolved: string[] } => {
    const d = disclosures.get(fundId)!;
    const lines = d.lines.filter((l) => l.weightPct > 0);
    const total = lines.reduce((s, l) => s + l.weightPct, 0);
    const scale = total > 100 ? 100 / total : 1;
    const unresolved: string[] = [];
    for (const l of lines) {
      const v = (value * l.weightPct * scale) / 100;
      if (l.kind === "equity" || l.kind === "foreign_equity") {
        addStock({ instrumentId: l.holdingInstrumentId, name: l.name, isin: l.isin, sector: l.sector, foreign: l.kind === "foreign_equity" }, v, top);
        addClass(l.kind === "equity" ? "equity" : "international", v);
      } else if (l.kind === "fund") {
        const child = l.holdingInstrumentId;
        if (child != null && disclosures.has(child) && depth < MAX_DEPTH && !path.has(child)) {
          const r = expand(child, v, top, depth + 1, new Set([...path, child]));
          unresolved.push(...r.unresolved);
        } else {
          const c = (child != null && fundClass.get(child)) || "other";
          addClass(c, v);
          if (c === "equity") equityNotLookedThrough += v;
          unresolved.push(l.name);
        }
      } else {
        addClass(l.kind === "debt" ? "debt" : l.kind === "cash" ? "cash" : "other", v);
      }
    }
    const itemisedPct = Math.min(total * scale, 100);
    if (itemisedPct < 100) addClass("not itemised", (value * (100 - itemisedPct)) / 100);
    return { itemised: itemisedPct / 100, unresolved };
  };

  for (const p of positions) {
    if (!(p.value > 0)) continue;
    if (p.type === "stock") {
      addStock({ instrumentId: p.instrumentId, name: stockInfo.get(p.instrumentId)?.name ?? "", isin: null, sector: null, foreign: false }, p.value, null);
      addClass("equity", p.value);
      continue;
    }
    const d = disclosures.get(p.instrumentId);
    if (!d) {
      addClass(p.assetClass, p.value);
      if (p.assetClass === "equity") equityNotLookedThrough += p.value;
      coverage.push({ fundId: p.instrumentId, value: p.value, asOf: null, itemised: 0, unresolvedFunds: [] });
      continue;
    }
    const r = expand(p.instrumentId, p.value, p.instrumentId, 0, new Set([p.instrumentId]));
    coverage.push({ fundId: p.instrumentId, value: p.value, asOf: d.asOf, itemised: r.itemised, unresolvedFunds: r.unresolved });
  }

  return {
    exposures: [...exp.values()].sort((a, b) => b.direct + b.viaFunds - (a.direct + a.viaFunds)),
    classes, coverage, equityNotLookedThrough,
    total: positions.reduce((s, p) => s + Math.max(p.value, 0), 0),
  };
}

/** A fund's effective stock weights (percent), FoFs flattened. */
export function effectiveWeights(fundId: number, disclosures: Map<number, LtDisclosure>): Map<string, number> {
  const lt = lookThrough([{ instrumentId: fundId, type: "mf", value: 100, assetClass: "equity" }], disclosures, new Map(), new Map());
  return new Map(lt.exposures.map((e) => [e.key, e.viaFunds]));
}

/**
 * Portfolio overlap between two funds: Σ min(wₐ, w_b) over the stocks both
 * hold — the share of one fund you'd already own through the other.
 */
export function overlap(a: Map<string, number>, b: Map<string, number>): { pct: number; common: number } {
  let pct = 0, common = 0;
  for (const [k, wa] of a) {
    const wb = b.get(k);
    if (wb != null) { pct += Math.min(wa, wb); common++; }
  }
  return { pct, common };
}

/** Group exposures by a key, in rupees, largest first. */
export function groupExposures(exposures: Exposure[], key: (e: Exposure) => string | null) {
  const m = new Map<string, number>();
  for (const e of exposures) {
    const k = key(e) || "Unclassified";
    m.set(k, (m.get(k) ?? 0) + e.direct + e.viaFunds);
  }
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].map(([name, value]) => ({ name, value, pct: total ? value / total : 0 })).sort((a, b) => b.value - a.value);
}
