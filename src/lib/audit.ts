import { db, schema } from "@/lib/db";

export async function audit(userId: string | null, action: string, detail?: unknown) {
  try {
    await db.insert(schema.auditLog).values({ userId, action, detail: detail ?? null });
  } catch (e) {
    console.error("audit failed", e);
  }
}
