import * as XLSX from "@e965/xlsx";
import { normHeader } from "./tabular";

// Header detection shared by the spreadsheet importers: find the first row that
// names the required columns, map every known field by alias, and let the
// person override any field's column from the preview.

export type Aliases = Record<string, string[]>;

export interface ColumnMap {
  /** Index of the header row in the grid. */
  headerRow: number;
  headers: string[];
  /** field → column index */
  map: Record<string, number>;
}

/** First sheet (or the first that has a usable header) as a grid of raw cells. */
export function readGrids(buf: Uint8Array, filename: string): { name: string; grid: unknown[][] }[] {
  // Dates stay serial numbers / text so no timezone can shift them (see tradebook.ts).
  const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: /\.csv$/i.test(filename) });
  return wb.SheetNames.map((name) => ({ name, grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }) }));
}

export function detectColumns(grid: unknown[][], aliases: Aliases, required: string[][]): ColumnMap | null {
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const cells = (grid[r] ?? []).map((c) => normHeader(String(c ?? "")));
    const map: Record<string, number> = {};
    for (const [field, names] of Object.entries(aliases)) {
      const i = cells.findIndex((c, j) => c && names.includes(c) && !Object.values(map).includes(j));
      if (i >= 0) map[field] = i;
    }
    // each inner list is "any of these"
    if (required.every((any) => any.some((f) => map[f] !== undefined))) {
      return { headerRow: r, headers: (grid[r] ?? []).map((c) => String(c ?? "").trim()), map };
    }
  }
  return null;
}

/** Overrides from the preview form: `map.<field>` = column index, or -1 for "not in this file". */
export function applyOverrides(cm: ColumnMap, overrides: Record<string, number>): ColumnMap {
  const map = { ...cm.map };
  for (const [f, i] of Object.entries(overrides)) {
    if (i < 0) delete map[f];
    else if (i < cm.headers.length) map[f] = i;
  }
  return { ...cm, map };
}

export const cell = (row: unknown[], cm: ColumnMap, f: string) => (cm.map[f] === undefined ? null : row[cm.map[f]] ?? null);
export const text = (row: unknown[], cm: ColumnMap, f: string) => String(cell(row, cm, f) ?? "").trim();
