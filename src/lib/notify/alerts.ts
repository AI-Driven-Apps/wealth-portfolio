import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { accessFor } from "@/lib/auth/access";
import { addDays, todayIST } from "@/lib/calc/dates";
import { computeDrift } from "@/lib/calc/drift";
import { getSetting } from "@/lib/settings";
import { getSips } from "@/lib/portfolio/sips";
import { consolidated, type Scope } from "@/lib/portfolio/consolidated";
import { getTargets } from "@/lib/portfolio/allocation";
import { classLabel, compact, fmtDate, money, pct, signedMoney } from "@/lib/format";
import { COLOR, decryptSecret, sendDiscord, type Embed } from "./discord";

export const ALERT_TYPES = [
  { key: "daily_summary", label: "Daily summary", hint: "Net worth, market value and today's change" },
  { key: "sip_due", label: "SIP due", hint: "Two days before each instalment", feature: "sip" },
  { key: "fd_maturity", label: "Maturities", hint: "FDs, RDs and bonds maturing within 7 days", feature: "other" },
  { key: "large_move", label: "Large moves", hint: "A holding moving more than the threshold in a day" },
  { key: "drift", label: "Allocation drift", hint: "An asset class outside its band (weekly reminder)", feature: "drift" },
  { key: "ai_brief", label: "AI market brief", hint: "Claude's evening brief on your holdings, sent when it's written (weekdays ~19:15 IST)", feature: "ai_agents" },
] as const;
export type AlertType = (typeof ALERT_TYPES)[number]["key"];

type Channel = typeof schema.notificationChannel.$inferSelect;
interface Item { type: AlertType; key: string; line: string; tone?: "gain" | "loss" | "warn" }

export const alertsSecret = () => config.alertsKey;

/** Whose money a channel reports on, and which modules apply: a global channel sees the household. */
async function channelScope(ch: Channel): Promise<(Scope & { label: string }) | null> {
  if (ch.scope === "global") {
    const profiles = await db.select().from(schema.profile);
    const flags = await db.select().from(schema.featureFlag);
    return { profileIds: profiles.map((p) => p.id), features: new Set(flags.filter((f) => f.enabled).map((f) => f.key)), label: "Household" };
  }
  if (!ch.ownerUserId) return null;
  const [u] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, ch.ownerUserId));
  if (!u || !u.isActive) return null;
  const a = await accessFor(u);
  // Personal channels need the admin's go-ahead (the discord_user module) unless the owner is an admin.
  if (u.role !== "admin" && !a.features.has("discord_user")) return null;
  return { profileIds: a.profiles.map((p) => p.id), features: a.features, label: a.profiles.length > 1 ? "Household" : a.profiles[0]?.name ?? u.name };
}

/** ISO week, "2026-W42": drift reminders repeat weekly, not daily. */
function isoWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

async function buildItems(s: Scope, label: string, wanted: Set<string>, today: string): Promise<{ items: Item[]; summary: Embed | null }> {
  const items: Item[] = [];
  const c = await consolidated(s, today);
  let summary: Embed | null = null;

  if (wanted.has("daily_summary")) {
    const t = c.marketTotals;
    summary = {
      title: `Daily summary · ${label}`, color: COLOR.info,
      fields: [
        { name: "Net worth", value: compact(c.net), inline: true },
        { name: "Market holdings", value: `${compact(t.value)} (${signedMoney(t.dayChange)} today)`, inline: true },
        { name: "XIRR", value: pct(t.xirr), inline: true },
        ...(c.fixed.length ? [{ name: "Fixed income & alternatives", value: compact(c.fixed.reduce((a, f) => a + f.now.value, 0)), inline: true }] : []),
        ...(c.loans.length ? [{ name: "Loans outstanding", value: compact(c.liabilities), inline: true }] : []),
      ],
    };
    items.push({ type: "daily_summary", key: today, line: "" });
  }

  if (wanted.has("sip_due") && s.features.has("sip")) {
    for (const sip of await getSips(s.profileIds)) {
      if (sip.next && sip.next >= today && sip.next <= addDays(today, 2)) {
        items.push({ type: "sip_due", key: `${sip.plan.id}:${sip.next}`, line: `**${money(sip.currentAmount)}** into ${sip.instrument.name} on ${fmtDate(sip.next)} (${sip.profileName})` });
      }
    }
  }

  if (wanted.has("fd_maturity")) {
    for (const f of c.fixed) {
      const m = f.asset.maturityDate;
      if (m && !f.asset.closedOn && m >= today && m <= addDays(today, 7)) {
        items.push({ type: "fd_maturity", key: `${f.asset.id}:${m}`, tone: "warn", line: `**${f.asset.name}**${f.asset.institution ? ` (${f.asset.institution})` : ""} matures ${fmtDate(m)}: ${money(f.maturity)} (${f.profileName})` });
      }
    }
  }

  if (wanted.has("large_move")) {
    const threshold = await getSetting("alert_move_pct");
    for (const h of c.market) {
      if (!(h.position.units > 0) || h.price == null || h.prevClose == null || !h.priceDate || h.priceDate < addDays(today, -4)) continue;
      const chg = h.price / h.prevClose - 1;
      if (Math.abs(chg) * 100 < threshold) continue;
      const name = h.instrument.type === "mf" ? h.instrument.name : h.instrument.nseSymbol ?? h.instrument.name;
      items.push({ type: "large_move", key: `${h.instrument.id}:${h.priceDate}`, tone: chg > 0 ? "gain" : "loss", line: `**${name}** ${pct(chg, 1, true)} on ${fmtDate(h.priceDate)} · your holding ${signedMoney(h.dayChange)}` });
    }
  }

  if (wanted.has("drift") && s.features.has("drift")) {
    const band = await getSetting("drift_default_band");
    const profiles = await db.select().from(schema.profile).where(inArray(schema.profile.id, s.profileIds));
    for (const p of profiles) {
      const targets = await getTargets(p.id);
      if (!targets.length) continue;
      const pc = await consolidated({ profileIds: [p.id], features: s.features }, today);
      for (const r of computeDrift(pc.classes, targets, band).filter((x) => x.breached)) {
        items.push({ type: "drift", key: `${p.id}:${r.assetClass}:${isoWeek(today)}`, tone: "warn", line: `**${p.name}**: ${classLabel(r.assetClass)} is ${r.currentPct.toFixed(1)}% vs target ${r.targetPct.toFixed(0)}% (band ±${r.band}) · ${r.toTarget >= 0 ? "add" : "trim"} ${money(Math.abs(r.toTarget))}` });
      }
    }
  }
  return { items, summary };
}

// ai_brief is sent by the agent itself when it finishes (lib/agents/brief.ts), not by this job.
const TITLES: Record<Exclude<AlertType, "daily_summary" | "ai_brief">, string> = {
  sip_due: "SIPs due", fd_maturity: "Maturing soon", large_move: "Large moves", drift: "Allocation drift",
};

function embedsFor(items: Item[], summary: Embed | null): Embed[] {
  const out: Embed[] = [];
  if (summary && items.some((i) => i.type === "daily_summary")) out.push(summary);
  for (const type of Object.keys(TITLES) as (keyof typeof TITLES)[]) {
    const list = items.filter((i) => i.type === type);
    if (!list.length) continue;
    const tone = list.every((i) => i.tone === "gain") ? COLOR.gain : list.some((i) => i.tone === "loss") ? COLOR.loss : COLOR.warn;
    out.push({ title: TITLES[type], color: tone, description: list.map((i) => `• ${i.line}`).join("\n") });
  }
  return out;
}

/** Sends what's new for one channel. Dedup rows are written first and removed again if Discord fails. */
async function runChannel(ch: Channel, today: string): Promise<{ sent: number; error?: string }> {
  const scope = await channelScope(ch);
  if (!scope || !scope.profileIds.length) return { sent: 0 };
  const subs = await db.select().from(schema.alertSubscription).where(and(eq(schema.alertSubscription.channelId, ch.id), eq(schema.alertSubscription.enabled, true)));
  const wanted = new Set(subs.map((s) => s.alertType));
  if (!wanted.size) return { sent: 0 };
  const { items, summary } = await buildItems(scope, scope.label, wanted, today);
  const fresh: Item[] = [];
  for (const it of items) {
    const res = await db.insert(schema.alertSent).values({ channelId: ch.id, alertType: it.type, key: it.key }).onConflictDoNothing().returning({ id: schema.alertSent.id });
    if (res.length) fresh.push(it);
  }
  if (!fresh.length) return { sent: 0 };
  const error = await sendDiscord(decryptSecret(ch.webhookEnc, alertsSecret()), embedsFor(fresh, summary));
  if (error) {
    for (const it of fresh) {
      await db.delete(schema.alertSent).where(and(eq(schema.alertSent.channelId, ch.id), eq(schema.alertSent.alertType, it.type), eq(schema.alertSent.key, it.key)));
    }
  }
  await db.update(schema.notificationChannel).set(error ? { lastError: error } : { lastError: null, lastSentAt: new Date() }).where(eq(schema.notificationChannel.id, ch.id));
  return { sent: error ? 0 : fresh.length, error: error ?? undefined };
}

/** The scheduled job: every enabled channel, idempotent per alert key. */
export async function runAlerts(): Promise<Record<string, unknown>> {
  if (config.isSample) return { skipped: "sample data" };
  const today = todayIST();
  const channels = await db.select().from(schema.notificationChannel).where(eq(schema.notificationChannel.enabled, true));
  let sent = 0; const errors: string[] = [];
  for (const ch of channels) {
    try {
      const r = await runChannel(ch, today);
      sent += r.sent;
      if (r.error) errors.push(`${ch.name}: ${r.error}`);
    } catch (e) {
      errors.push(`${ch.name}: ${(e as Error).message}`);
    }
  }
  return { channels: channels.length, sent, errors };
}

export async function sendTest(ch: Channel): Promise<string | null> {
  const error = await sendDiscord(decryptSecret(ch.webhookEnc, alertsSecret()), [{
    title: "Test message", color: COLOR.info,
    description: `This channel ("${ch.name}") is connected to Wealth Portfolio. Alerts arrive once a day around 08:00 IST.`,
  }]);
  await db.update(schema.notificationChannel).set(error ? { lastError: error } : { lastError: null, lastSentAt: new Date() }).where(eq(schema.notificationChannel.id, ch.id));
  return error;
}
