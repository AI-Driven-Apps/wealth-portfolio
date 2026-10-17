import { redirect } from "next/navigation";
import clsx from "clsx";
import { and, eq, inArray } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { ALERT_TYPES } from "@/lib/notify/alerts";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, Badge, Notice, btnGhost, btnDanger } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { saveAlertSettings } from "../admin/actions";
import { addChannel, deleteChannel, testChannel, toggleChannel, toggleSubscription } from "./actions";

export const metadata = { title: "Discord alerts" };

type Channel = typeof schema.notificationChannel.$inferSelect;

function ChannelCard({ ch, subs, features }: { ch: Channel; subs: Map<string, boolean>; features: Set<string> }) {
  return (
    <Card className="mb-3" title={<span className="flex items-center gap-2">{ch.name}<span className="num text-[12px] font-normal text-ink-3">webhook …{ch.webhookHint}</span></span>}
      actions={<div className="flex items-center gap-1.5">
        {ch.lastError ? <Badge kind="loss" title={ch.lastError}>last send failed</Badge> : ch.lastSentAt ? <Badge kind="accent">sent {ch.lastSentAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</Badge> : null}
        <form action={toggleChannel}><input type="hidden" name="id" value={ch.id} /><button className={btnGhost}>{ch.enabled ? "Pause" : "Resume"}</button></form>
        <form action={deleteChannel}><input type="hidden" name="id" value={ch.id} /><button className={btnDanger}>Remove</button></form>
      </div>}>
      <div className="flex flex-wrap gap-2">
        {ALERT_TYPES.map((t) => {
          const on = subs.get(t.key) ?? false;
          const unavailable = "feature" in t && !features.has(t.feature);
          return (
            <form key={t.key} action={toggleSubscription}>
              <input type="hidden" name="id" value={ch.id} /><input type="hidden" name="type" value={t.key} /><input type="hidden" name="enabled" value={on ? "false" : "true"} />
              <button aria-pressed={on} disabled={!ch.enabled} title={unavailable ? `${t.hint} (module is off)` : t.hint}
                className={clsx("rounded-full px-3 py-1 text-[12px] font-medium disabled:opacity-40", on ? "bg-accent text-accent-ink" : "border border-line text-ink-2", unavailable && on && "opacity-60")}>
                {on ? "✓ " : ""}{t.label}
              </button>
            </form>
          );
        })}
      </div>
      {!ch.enabled && <p className="mt-2 text-[12px] text-ink-3">Paused: nothing is sent.</p>}
      {ch.lastError && <p className="mt-2 text-[12px] text-loss">{ch.lastError}</p>}
      <ActionForm action={testChannel} submit="Send test" ghost className="mt-3"><input type="hidden" name="id" value={ch.id} /></ActionForm>
    </Card>
  );
}

function AddChannel({ scope }: { scope: "user" | "global" }) {
  return (
    <ActionForm action={addChannel} submit="Add channel" className="grid gap-3 sm:grid-cols-[180px_1fr]">
      <input type="hidden" name="scope" value={scope} />
      <div className="flex flex-col gap-1"><label htmlFor={`n-${scope}`}>Name</label><input id={`n-${scope}`} name="name" maxLength={60} placeholder={scope === "global" ? "#family-money" : "My alerts"} /></div>
      <div className="flex flex-col gap-1"><label htmlFor={`w-${scope}`}>Webhook URL</label><input id={`w-${scope}`} name="webhook" type="password" autoComplete="off" required placeholder="https://discord.com/api/webhooks/…" /></div>
    </ActionForm>
  );
}

export default async function AlertsPage() {
  const ctx = await requireCtx();
  const admin = ctx.user.role === "admin";
  const personal = admin || ctx.features.has("discord_user");
  if (!personal) redirect("/?denied=discord_user");

  const channels = await db.select().from(schema.notificationChannel)
    .where(admin ? undefined : and(eq(schema.notificationChannel.scope, "user"), eq(schema.notificationChannel.ownerUserId, ctx.user.id)))
    .orderBy(schema.notificationChannel.createdAt);
  const mine = channels.filter((c) => c.scope === "user" && c.ownerUserId === ctx.user.id);
  const global = channels.filter((c) => c.scope === "global");
  const subs = channels.length ? await db.select().from(schema.alertSubscription).where(inArray(schema.alertSubscription.channelId, channels.map((c) => c.id))) : [];
  const subsFor = (id: string) => new Map(subs.filter((s) => s.channelId === id).map((s) => [s.alertType, s.enabled]));
  const [band, move] = admin ? await Promise.all([getSetting("drift_default_band"), getSetting("alert_move_pct")]) : [0, 0];

  return (
    <>
      <PageHeader title="Discord alerts" sub="A daily message around 08:00 IST with whatever is new: summary, SIPs due, maturities, large moves and drift. Each alert is sent once per channel." />
      {config.isVercel && <div className="mb-4"><Notice>Discord alerts are switched off on the demo: nothing is sent from here.</Notice></div>}

      <h2 className="mb-2 text-[13px] font-semibold">Your channels <span className="font-normal text-ink-3">· about {ctx.profiles.length > 1 ? "every profile you can see" : "your profile"}</span></h2>
      {mine.map((ch) => <ChannelCard key={ch.id} ch={ch} subs={subsFor(ch.id)} features={ctx.features} />)}
      {!config.isVercel && <Card title="Add a personal channel" className="mb-6"><AddChannel scope="user" /></Card>}

      {admin && (
        <>
          <h2 className="mb-2 text-[13px] font-semibold">Household channels <span className="font-normal text-ink-3">· every profile, managed by admins</span></h2>
          {global.map((ch) => <ChannelCard key={ch.id} ch={ch} subs={subsFor(ch.id)} features={new Set(ctx.features)} />)}
          {!config.isVercel && <Card title="Add a household channel" className="mb-6"><AddChannel scope="global" /></Card>}
          <Card title="Thresholds">
            <ActionForm action={saveAlertSettings} submit="Save" className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1"><label htmlFor="band">Default drift band (± points)</label><input id="band" name="band" type="number" min="1" max="30" step="any" defaultValue={band} /></div>
              <div className="flex flex-col gap-1"><label htmlFor="move">Large move: one-day change over (%)</label><input id="move" name="move" type="number" min="1" max="50" step="any" defaultValue={move} /></div>
            </ActionForm>
            <p className="mt-2 text-[12px] text-ink-3">Members can only add channels when "Personal Discord alerts" is ticked for them under Admin → Features. Webhook URLs are stored encrypted and never shown again.</p>
          </Card>
        </>
      )}
    </>
  );
}
