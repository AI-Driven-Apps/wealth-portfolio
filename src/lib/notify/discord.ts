import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Discord webhooks, ported from NSE-Signal's app/notify.py (embeds, a
// "not financial advice" footer, never throw into the caller) and extended
// with per-user / global channels. A webhook URL is a write credential, so it
// is stored AES-256-GCM encrypted and only ever decrypted server-side to send.

const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})$/;

/** Only real Discord webhook URLs, so a channel can't be pointed at an internal host. */
export function parseWebhook(url: string): { url: string; hint: string } | null {
  const u = url.trim();
  const m = WEBHOOK_RE.exec(u);
  return m ? { url: u, hint: m[2].slice(-4) } : null;
}

function key(secret: string): Buffer {
  if (!secret || secret.length < 32) throw new Error("ALERTS_KEY (or JWT_SECRET) must be set (32+ chars) to store webhooks");
  return createHash("sha256").update(`wealth-portfolio:webhook:${secret}`).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(secret), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(enc: string, secret: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised encrypted value");
  const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export interface Embed {
  title: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  url?: string;
}

export const COLOR = { info: 0x2f5d50, gain: 0x2ecc71, loss: 0xe74c3c, warn: 0xe2b55c } as const;
const FOOTER = "Wealth Portfolio · not financial advice";

/** Posts up to 10 embeds. Returns null on success, or the error text. One retry on 429. */
export async function sendDiscord(webhookUrl: string, embeds: Embed[]): Promise<string | null> {
  if (!parseWebhook(webhookUrl)) return "Not a Discord webhook URL";
  const body = JSON.stringify({
    username: "Wealth Portfolio",
    allowed_mentions: { parse: [] },
    embeds: embeds.slice(0, 10).map((e) => ({
      ...e,
      description: e.description?.slice(0, 4000),
      fields: e.fields?.slice(0, 25).map((f) => ({ ...f, value: f.value.slice(0, 1000) || "—" })),
      footer: { text: FOOTER },
    })),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(10_000) });
      if (r.ok) return null;
      if (r.status === 429 && attempt === 0) {
        const j = (await r.json().catch(() => ({}))) as { retry_after?: number };
        await new Promise((res) => setTimeout(res, Math.min((j.retry_after ?? 1) * 1000, 10_000)));
        continue;
      }
      return `Discord answered HTTP ${r.status}${r.status === 404 ? " (webhook deleted?)" : ""}`;
    } catch (e) {
      return (e as Error).message;
    }
  }
  return "Discord rate limit";
}
