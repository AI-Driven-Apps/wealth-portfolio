import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Small admin-tunable settings kept in app_setting, with defaults in code.
export const SETTING_DEFAULTS = {
  drift_default_band: 5,   // percentage points
  alert_move_pct: 5,       // a holding's one-day move that triggers a "large move" alert
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(k: SettingKey): Promise<number> {
  const [row] = await db.select().from(schema.appSetting).where(eq(schema.appSetting.key, k));
  const v = Number(row?.value);
  return row && Number.isFinite(v) ? v : SETTING_DEFAULTS[k];
}

export async function setSetting(k: SettingKey, value: number) {
  await db.insert(schema.appSetting).values({ key: k, value })
    .onConflictDoUpdate({ target: schema.appSetting.key, set: { value, updatedAt: new Date() } });
}
