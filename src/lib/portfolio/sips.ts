import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { expectedInstalments, matchInstalments, nextDue, type InstalmentStatus } from "@/lib/calc/sip";
import { todayIST, addDays } from "@/lib/calc/dates";
import { detectSip, type DetectedSip } from "@/lib/calc/sipDetect";

export interface SipView {
  plan: typeof schema.sipPlan.$inferSelect;
  instrument: typeof schema.instrument.$inferSelect;
  profileName: string;
  currentAmount: number;
  next: string | null;
  statuses: InstalmentStatus[];
  paid: number; missed: number;
  investedViaSip: number;
}

export async function getSips(profileIds: string[]): Promise<SipView[]> {
  if (!profileIds.length) return [];
  const plans = await db.select({ plan: schema.sipPlan, instrument: schema.instrument, profileName: schema.profile.name })
    .from(schema.sipPlan)
    .innerJoin(schema.instrument, eq(schema.instrument.id, schema.sipPlan.instrumentId))
    .innerJoin(schema.profile, eq(schema.profile.id, schema.sipPlan.profileId))
    .where(inArray(schema.sipPlan.profileId, profileIds));
  const today = todayIST();
  const out: SipView[] = [];
  for (const { plan, instrument, profileName } of plans) {
    const purchases = await db.select({ date: schema.txn.date, amount: schema.txn.amount }).from(schema.txn)
      .where(and(eq(schema.txn.profileId, plan.profileId), eq(schema.txn.instrumentId, plan.instrumentId), inArray(schema.txn.type, ["sip", "buy"])));
    const input = { amount: Number(plan.amount), dayOfMonth: plan.dayOfMonth, stepUpPct: Number(plan.stepUpPct), startDate: plan.startDate, endDate: plan.endDate };
    const expected = expectedInstalments(input, plan.active ? today : (plan.endDate ?? today));
    const statuses = matchInstalments(expected, purchases.map((p) => ({ date: p.date, amount: Number(p.amount) })), today);
    const upcoming = expectedInstalments(input, addDays(today, 400)).filter((e) => e.due >= today);
    out.push({
      plan, instrument, profileName,
      currentAmount: upcoming[0]?.amount ?? Number(plan.amount),
      next: plan.active ? nextDue(input, today) : null,
      statuses,
      paid: statuses.filter((s) => s.status === "paid").length,
      missed: statuses.filter((s) => s.status === "missed").length,
      investedViaSip: statuses.reduce((s, x) => s + (x.matchedAmount ?? 0), 0),
    });
  }
  return out.sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999"));
}

export interface SipCandidate {
  instrumentId: number;
  instrumentName: string;
  accountId: string | null;
  accountLabel: string | null;
  plan: DetectedSip;
}

/**
 * Recurring monthly purchases in a profile's mutual funds that have no SIP plan
 * yet, e.g. right after importing a CAS. Per fund and folio.
 */
export async function sipCandidates(profileId: string): Promise<SipCandidate[]> {
  const rows = await db.select({ t: schema.txn, name: schema.instrument.name, acct: schema.account.label })
    .from(schema.txn)
    .innerJoin(schema.instrument, eq(schema.instrument.id, schema.txn.instrumentId))
    .leftJoin(schema.account, eq(schema.account.id, schema.txn.accountId))
    .where(and(eq(schema.txn.profileId, profileId), eq(schema.instrument.type, "mf"), inArray(schema.txn.type, ["sip", "buy"])));
  const planned = new Set((await db.select({ i: schema.sipPlan.instrumentId }).from(schema.sipPlan).where(eq(schema.sipPlan.profileId, profileId))).map((r) => r.i));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (planned.has(r.t.instrumentId)) continue;
    const k = `${r.t.instrumentId}|${r.t.accountId ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const today = todayIST();
  const out: SipCandidate[] = [];
  for (const g of groups.values()) {
    const plan = detectSip(g.map((r) => ({ date: r.t.date, amount: Number(r.t.amount), type: r.t.type })), today);
    if (plan) out.push({ instrumentId: g[0].t.instrumentId, instrumentName: g[0].name, accountId: g[0].t.accountId, accountLabel: g[0].acct, plan });
  }
  return out.sort((a, b) => Number(b.plan.active) - Number(a.plan.active) || a.instrumentName.localeCompare(b.instrumentName));
}
