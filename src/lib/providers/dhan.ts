// Read-only Dhan market-data client, written from NSE-Signal's app/dhan_client.py.
// No order endpoints exist here, by design: execution stays manual.
//
// Carried over from NSE-Signal:
//  - access tokens live 24 h; we track issue time and refuse a stale token
//    instead of serving stale data,
//  - marketfeed is capped at 1 request/second, so calls are spaced 1.1 s apart,
//  - a bare 401 usually means the Data API subscription isn't active on the
//    account (a trading token alone doesn't grant live quotes),
//  - DHAN_CLIENT_ID may arrive quoted from docker env files; strip quotes.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";

const LTP_URL = "https://api.dhan.co/v2/marketfeed/ltp";
export const SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master.csv";
const TOKEN_LIFETIME_H = 24;
const MIN_INTERVAL_MS = 1100;
const TOKEN_KEY = "dhan_token";

export class DhanError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

interface TokenState { token: string; issuedAt: string }

export async function setDhanToken(token: string) {
  const value: TokenState = { token: token.trim(), issuedAt: new Date().toISOString() };
  await db.insert(schema.appSetting).values({ key: TOKEN_KEY, value })
    .onConflictDoUpdate({ target: schema.appSetting.key, set: { value, updatedAt: new Date() } });
}

export async function dhanTokenStatus(): Promise<{ configured: boolean; hoursRemaining: number }> {
  const [row] = await db.select().from(schema.appSetting).where(eq(schema.appSetting.key, TOKEN_KEY));
  if (!row || !config.dhanClientId) return { configured: false, hoursRemaining: 0 };
  const st = row.value as TokenState;
  const left = TOKEN_LIFETIME_H - (Date.now() - Date.parse(st.issuedAt)) / 3_600_000;
  return { configured: true, hoursRemaining: Math.max(0, left) };
}

async function token(): Promise<string> {
  if (config.isVercel) throw new DhanError("Dhan is not used on the Vercel demo.");
  if (!config.dhanClientId) throw new DhanError("DHAN_CLIENT_ID is not set.");
  const [row] = await db.select().from(schema.appSetting).where(eq(schema.appSetting.key, TOKEN_KEY));
  if (!row) throw new DhanError("No Dhan access token on record. Paste one under Admin → Data sources.");
  const st = row.value as TokenState;
  if (Date.now() - Date.parse(st.issuedAt) > TOKEN_LIFETIME_H * 3_600_000) {
    throw new DhanError("Dhan access token is older than 24 hours. Generate a fresh one at web.dhan.co.");
  }
  return st.token;
}

let lastCall = 0;
async function throttle() {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Last traded price for NSE cash instruments, keyed by Dhan security id. Up to 1000 per call. */
export async function getLtp(securityIds: string[]): Promise<Record<string, number>> {
  if (!securityIds.length) return {};
  const out: Record<string, number> = {};
  for (let i = 0; i < securityIds.length; i += 1000) {
    const chunk = securityIds.slice(i, i + 1000);
    await throttle();
    const res = await fetch(LTP_URL, {
      method: "POST",
      headers: { "access-token": await token(), "client-id": config.dhanClientId, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ NSE_EQ: chunk.map(Number) }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const body = await res.json().catch(() => null) as { status?: string; data?: { NSE_EQ?: Record<string, { last_price?: number }> } ; errorMessage?: string } | null;
    if (res.status === 401) throw new DhanError("Dhan refused live quotes (401). The Data API subscription may not be active on this account, or the token/client id is wrong.", 401);
    if (!res.ok || body?.status !== "success") throw new DhanError(`Dhan LTP failed: HTTP ${res.status} ${body?.errorMessage ?? ""}`.trim(), res.status);
    for (const [id, q] of Object.entries(body.data?.NSE_EQ ?? {})) if (q.last_price && q.last_price > 0) out[id] = q.last_price;
  }
  return out;
}

/** NSE cash-segment rows of the compact scrip master: trading symbol -> security id. */
export function parseScripMaster(csv: string): Map<string, string> {
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(",");
  const ix = (n: string) => header.indexOf(n);
  const [ex, seg, id, sym, series] = [ix("SEM_EXM_EXCH_ID"), ix("SEM_SEGMENT"), ix("SEM_SMST_SECURITY_ID"), ix("SEM_TRADING_SYMBOL"), ix("SEM_SERIES")];
  const map = new Map<string, string>();
  if ([ex, seg, id, sym].some((i) => i < 0)) return map;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c[ex] !== "NSE" || c[seg] !== "E") continue;
    if (series >= 0 && !["EQ", "BE", "BZ", ""].includes(c[series])) continue;
    map.set(c[sym].trim().toUpperCase(), c[id].trim());
  }
  return map;
}
