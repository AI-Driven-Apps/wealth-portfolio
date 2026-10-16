// Dates are handled as ISO "YYYY-MM-DD" strings end to end (Postgres DATE),
// and converted to UTC day numbers only for maths — no timezone drift.
export const DAY_MS = 86_400_000;

export function toDayNum(d: string | Date): number {
  const iso = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return Date.parse(iso + "T00:00:00Z") / DAY_MS;
}

export function fromDayNum(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function todayIST(): string {
  // IST = UTC+05:30; markets and NAVs are dated in IST.
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNum(toDayNum(iso) + days);
}

export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0); // Feb 29 -> Feb 28
  return dt.toISOString().slice(0, 10);
}

export function yearsBetween(a: string, b: string): number {
  return (toDayNum(b) - toDayNum(a)) / 365;
}
