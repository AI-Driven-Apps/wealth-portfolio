const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const units = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** ₹12,34,567 (Indian grouping). */
export function money(v: number | null | undefined, decimals = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (decimals ? inr2 : inr).format(Math.abs(v));
  return `${v < 0 ? "−" : ""}₹${s}`;
}

/** ₹12.3 L / ₹1.24 Cr, for headline numbers. */
export function compact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return money(v);
}

export function signedMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + money(v);
}

export function pct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s.replace("-", "−")}%`;
}

export const fmtUnits = (v: number) => units.format(v);
export const fmtPrice = (v: number | null | undefined) => (v == null ? "—" : inr2.format(v));

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const tone = (v: number | null | undefined) => (v == null || v === 0 ? "text-ink-2" : v > 0 ? "text-gain" : "text-loss");
