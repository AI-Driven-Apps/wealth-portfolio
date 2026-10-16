"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCtx, writableProfile } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { callParser } from "@/lib/import/parserClient";
import { mapCas } from "@/lib/import/cas";
import { parseTradebook } from "@/lib/import/tradebook";
import { mapContractNote } from "@/lib/import/contractNote";
import { enrichPreview, commitImport, deleteImport } from "@/lib/import/commit";
import type { ImportPreview } from "@/lib/import/types";
import { audit } from "@/lib/audit";

type Result = { error: string } | { preview: Awaited<ReturnType<typeof enrichPreview>> } | null;

async function guard() {
  const ctx = await requireCtx("imports");
  if (!config.importsEnabled) throw new Error("Imports are switched off on this deployment.");
  return { ctx, profileId: writableProfile(ctx) };
}

export async function previewImport(_: unknown, fd: FormData): Promise<Result> {
  try {
    const { profileId } = await guard();
    const kind = String(fd.get("kind"));
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
    if (file.size > 15 * 1024 * 1024) return { error: "File is larger than 15 MB." };
    const password = String(fd.get("password") ?? "");
    const broker = String(fd.get("broker") ?? "").trim() || "Broker";
    const accountRef = String(fd.get("accountRef") ?? "").trim() || "default";
    let p: ImportPreview;
    if (kind === "cas") {
      p = mapCas(await callParser("/cas", file, password) as never, file.name);
    } else if (kind === "tradebook") {
      if (!/\.(xlsx?|csv)$/i.test(file.name)) return { error: "Tradebooks must be .xls, .xlsx or .csv." };
      p = parseTradebook(new Uint8Array(await file.arrayBuffer()), file.name, broker, accountRef);
    } else if (kind === "contract_note") {
      p = mapContractNote(await callParser("/contract-note", file, password) as never, file.name, broker, accountRef);
    } else return { error: "Unknown import type." };
    return { preview: await enrichPreview(p, profileId) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const Row = z.object({
  assetHint: z.enum(["mf", "stock", "etf", "unknown"]), isin: z.string().nullable(), amfiCode: z.string().nullable(), symbol: z.string().nullable(),
  name: z.string().min(1).max(300), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["buy", "sell", "sip", "switch_in", "switch_out", "dividend_payout", "dividend_reinvest", "bonus", "split"]),
  units: z.number().min(0), price: z.number().min(0), amount: z.number().min(0), fees: z.number().min(0),
  account: z.object({ kind: z.enum(["folio", "demat"]), provider: z.string().max(60), ref: z.string().max(80) }),
  dedupKey: z.string().min(1).max(400), note: z.string().max(500).optional(),
});
const Preview = z.object({
  source: z.enum(["cas", "demat_cas", "tradebook", "contract_note"]), filename: z.string().max(300),
  rows: z.array(Row).max(20000), skipped: z.array(z.any()).optional(), warnings: z.array(z.string()).optional(),
});

export async function commitPreview(_: unknown, payload: string): Promise<{ error: string } | { ok: string } | null> {
  try {
    const { ctx, profileId } = await guard();
    const p = Preview.parse(JSON.parse(payload));
    const today = new Date().toISOString().slice(0, 10);
    if (p.rows.some((r) => r.date > today)) return { error: "Some rows have dates in the future; check the file." };
    const r = await commitImport({ ...p, skipped: [], warnings: [] }, profileId, ctx.user.id);
    await audit(ctx.user.id, "import", { profileId, source: p.source, filename: p.filename, ...r });
    revalidatePath("/", "layout");
    return { ok: `Saved ${r.inserted} transaction${r.inserted === 1 ? "" : "s"}${r.duplicates ? `, skipped ${r.duplicates} already imported` : ""}${r.newInstruments ? `, added ${r.newInstruments} new instrument${r.newInstruments === 1 ? "" : "s"}` : ""}.` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? "The preview data was not valid. Re-upload the file." : (e as Error).message };
  }
}

export async function undoImport(fd: FormData) {
  const { ctx } = await guard();
  const id = String(fd.get("id"));
  await deleteImport(id, ctx.profileIds);
  await audit(ctx.user.id, "import.undo", { id });
  revalidatePath("/", "layout");
}
