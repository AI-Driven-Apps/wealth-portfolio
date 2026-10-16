import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { expectedInstalments, matchInstalments, nextDue, type InstalmentStatus } from "@/lib/calc/sip";
import { todayIST, addDays } from "@/lib/calc/dates";

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
