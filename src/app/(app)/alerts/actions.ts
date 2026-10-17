"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { requireCtx, type Ctx } from "@/lib/auth/session";
import { encryptSecret, parseWebhook } from "@/lib/notify/discord";
import { ALERT_TYPES, alertsSecret, sendTest } from "@/lib/notify/alerts";
import { audit } from "@/lib/audit";

type R = { error: string } | { ok: string } | null;
const isAdmin = (ctx: Ctx) => ctx.user.role === "admin";

/** Global channels: admin only. Personal channels: their owner, if the admin allows personal alerts. */
async function channelFor(id: string) {
  const ctx = await requireCtx();
  const [ch] = await db.select().from(schema.notificationChannel).where(eq(schema.notificationChannel.id, id));
  const ok = ch && (ch.scope === "global" ? isAdmin(ctx) : ch.ownerUserId === ctx.user.id && (isAdmin(ctx) || ctx.features.has("discord_user")));
  if (!ok) throw new Error("Channel not found.");
  return { ctx, ch };
}

export async function addChannel(_: unknown, fd: FormData): Promise<R> {
  const ctx = await requireCtx();
  if (config.isSample) return { error: "Discord alerts are switched off on the demo." };
  const scope = fd.get("scope") === "global" ? "global" : "user";
  if (scope === "global" && !isAdmin(ctx)) return { error: "Only the admin can add household channels." };
  if (scope === "user" && !isAdmin(ctx) && !ctx.features.has("discord_user")) return { error: "Personal alerts aren't enabled for you. Ask the admin." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 60) || "Discord";
  const hook = parseWebhook(String(fd.get("webhook") ?? ""));
  if (!hook) return { error: "Paste a Discord webhook URL (Server settings → Integrations → Webhooks → Copy URL)." };
  const [ch] = await db.insert(schema.notificationChannel).values({
    scope, ownerUserId: scope === "user" ? ctx.user.id : null, name,
    webhookEnc: encryptSecret(hook.url, alertsSecret()), webhookHint: hook.hint,
  }).returning({ id: schema.notificationChannel.id });
  await db.insert(schema.alertSubscription).values(ALERT_TYPES.map((t) => ({ channelId: ch.id, alertType: t.key, enabled: true })));
  await audit(ctx.user.id, "channel.add", { id: ch.id, scope, name });
  revalidatePath("/alerts");
  return { ok: `Added "${name}". Send a test to check it.` };
}

export async function toggleChannel(fd: FormData) {
  const { ctx, ch } = await channelFor(String(fd.get("id")));
  await db.update(schema.notificationChannel).set({ enabled: !ch.enabled }).where(eq(schema.notificationChannel.id, ch.id));
  await audit(ctx.user.id, "channel.toggle", { id: ch.id, enabled: !ch.enabled });
  revalidatePath("/alerts");
}

export async function deleteChannel(fd: FormData) {
  const { ctx, ch } = await channelFor(String(fd.get("id")));
  await db.delete(schema.notificationChannel).where(eq(schema.notificationChannel.id, ch.id));
  await audit(ctx.user.id, "channel.delete", { id: ch.id });
  revalidatePath("/alerts");
}

export async function toggleSubscription(fd: FormData) {
  const { ctx, ch } = await channelFor(String(fd.get("id")));
  const type = String(fd.get("type"));
  if (!ALERT_TYPES.some((t) => t.key === type)) throw new Error("Unknown alert type.");
  const enabled = fd.get("enabled") === "true";
  await db.insert(schema.alertSubscription).values({ channelId: ch.id, alertType: type, enabled })
    .onConflictDoUpdate({ target: [schema.alertSubscription.channelId, schema.alertSubscription.alertType], set: { enabled } });
  await audit(ctx.user.id, "channel.subscription", { id: ch.id, type, enabled });
  revalidatePath("/alerts");
}

export async function testChannel(_: unknown, fd: FormData): Promise<R> {
  try {
    const { ctx, ch } = await channelFor(String(fd.get("id")));
    if (config.isSample) return { error: "Discord alerts are switched off on the demo." };
    const err = await sendTest(ch);
    await audit(ctx.user.id, "channel.test", { id: ch.id, ok: !err });
    revalidatePath("/alerts");
    return err ? { error: err } : { ok: "Sent. Check the channel." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
