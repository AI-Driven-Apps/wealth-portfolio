// Order/trade status filter shared by the tradebook and spreadsheet imports.
// Broker exports often mix executed trades with orders that never filled
// (HDFC Securities: "Confirmed Trade" next to "Expired Order"). When a file has a
// status column, only rows whose status says the trade happened are imported;
// everything else — including statuses we don't recognise — is listed as skipped.

export const STATUS_ALIASES = ["status", "orderstatus", "tradestatus", "transactionstatus", "txnstatus", "executionstatus"];

const NOT_DONE = /reject|cancel|expir|fail|pending|open|lapse|partial|unsuccess|\bnot\b|\bno\b|invalid|trigger|modif|revers|refund|await|queue|progress|placed|initiat/;
const DONE = /confirm|complet|execut|success|traded|filled|settled|allot|processed|\bdone\b|^ok$/;

/** True only for statuses that mean the trade was executed. */
export function isExecutedStatus(raw: string): boolean {
  const s = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!s || NOT_DONE.test(s)) return false;
  return DONE.test(s);
}

/** Skip reason for the preview; grouping by reason gives a count per status. */
export const notExecuted = (raw: string) => (raw.trim() ? `not executed (status "${raw.trim().slice(0, 40)}")` : "no status");

/** One preview line for the rows left out by status, e.g. "Expired Order ×10, Rejected ×2". */
export function statusSummary(skipped: { reason: string }[]): string | null {
  const counts = new Map<string, number>();
  for (const s of skipped) {
    const m = /^not executed \(status "(.*)"\)$|^(no status)$/.exec(s.reason);
    if (m) counts.set(m[1] ?? m[2], (counts.get(m[1] ?? m[2]) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  return `Left out ${n} row${n === 1 ? "" : "s"} that weren't executed: ${[...counts].map(([k, v]) => `${k} ×${v}`).join(", ")}.`;
}
