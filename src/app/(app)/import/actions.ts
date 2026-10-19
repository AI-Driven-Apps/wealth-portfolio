"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCtx, writableProfile } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { callParser } from "@/lib/import/parserClient";
import { mapCas } from "@/lib/import/cas";
import { parseTradebook } from "@/lib/import/tradebook";
import { mapContractNote } from "@/lib/import/contractNote";
import { parseSpreadsheet, type SpreadsheetPreview } from "@/lib/import/spreadsheet";
import { parseFixedSheet, parseLoanSheet, type FixedRecord, type LoanRecord, type RecordsPreview } from "@/lib/import/records";
import { enrichPreview, commitImport, deleteImport } from "@/lib/import/commit";
import { commitFixed, commitLoans } from "@/lib/import/commitRecords";
import { sipCandidates, type SipCandidate } from "@/lib/portfolio/sips";
import type { ImportPreview } from "@/lib/import/types";
import { audit } from "@/lib/audit";
import { readGrids } from "@/lib/import/columns";
import { parseCodeList } from "@/lib/import/codes";
import { saveCodeList, forgetCodes } from "@/lib/import/aliases";

export type TxnPreview = Awaited<ReturnType<typeof enrichPreview>> & { columns?: SpreadsheetPreview["columns"] };
export type RecordsResult =
  | { kind: "fixed"; filename: string; preview: RecordsPreview<FixedRecord> }
  | { kind: "loans"; filename: string; preview: RecordsPreview<LoanRecord> };
type Result = { error: string } | { preview: TxnPreview } | { records: RecordsResult } | null;

async function guard(feature = "imports") {
  const ctx = await requireCtx("imports");
  if (!config.importsEnabled) throw new Error("Imports are switched off on this deployment.");
  if (feature !== "imports" && !ctx.features.has(feature)) throw new Error("That module isn't enabled for you.");
  return { ctx, profileId: writableProfile(ctx) };
}

const SPREADSHEET = /\.(xlsx?|csv)$/i;

export async function previewImport(_: unknown, fd: FormData): Promise<Result> {
  try {
    const kind = String(fd.get("kind"));
    const { profileId } = await guard(kind === "fixed" ? "other" : kind === "loans" ? "loans" : "imports");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
    if (file.size > 15 * 1024 * 1024) return { error: "File is larger than 15 MB." };
    const password = String(fd.get("password") ?? "");
    const broker = String(fd.get("broker") ?? "").trim() || "Broker";
    const accountRef = String(fd.get("accountRef") ?? "").trim() || "default";
    if (["tradebook", "spreadsheet", "fixed", "loans"].includes(kind) && !SPREADSHEET.test(file.name)) return { error: "Upload a .xls, .xlsx or .csv file." };
    const buf = () => file.arrayBuffer().then((b) => new Uint8Array(b));

    if (kind === "fixed") return { records: { kind, filename: file.name, preview: parseFixedSheet(await buf(), file.name) } };
    if (kind === "loans") return { records: { kind, filename: file.name, preview: parseLoanSheet(await buf(), file.name) } };

    let p: ImportPreview, columns: SpreadsheetPreview["columns"] | undefined;
    if (kind === "cas") {
      p = mapCas(await callParser("/cas", file, password) as never, file.name);
    } else if (kind === "tradebook") {
      const note = await importCodeList(fd.get("codes"), broker, password);
      p = parseTradebook(await buf(), file.name, broker, accountRef);
      if (note) p.warnings.unshift(note);
    } else if (kind === "contract_note") {
      p = mapContractNote(await callParser("/contract-note", file, password) as never, file.name, broker, accountRef);
    } else if (kind === "spreadsheet") {
      // Column overrides from the preview: map.<field> = column index (-1 = not in file).
      const overrides: Record<string, number> = {};
      for (const [k, v] of fd.entries()) if (k.startsWith("map.") && v !== "") overrides[k.slice(4)] = Number(v);
      const sp = parseSpreadsheet(await buf(), file.name, overrides, String(fd.get("platform") ?? "").trim() || "Spreadsheet");
      p = sp; columns = sp.columns;
    } else return { error: "Unknown import type." };
    return { preview: { ...(await enrichPreview(p, profileId)), columns } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The optional broker code list sent with a tradebook: saved before the tradebook is read. */
async function importCodeList(f: FormDataEntryValue | null, broker: string, password: string): Promise<string | null> {
  if (!(f instanceof File) || f.size === 0) return null;
  if (f.size > 15 * 1024 * 1024) throw new Error("Code list is larger than 15 MB.");
  let grid: unknown[][];
  if (/\.pdf$/i.test(f.name)) {
    grid = (await callParser("/tables", f, password) as { rows: string[][] }).rows;
  } else if (SPREADSHEET.test(f.name)) {
    const sheets = readGrids(new Uint8Array(await f.arrayBuffer()), f.name);
    grid = sheets.find((s) => parseCodeList(s.grid).found)?.grid ?? [];
  } else throw new Error("Upload the code list as .csv, .xls, .xlsx or .pdf.");
  const list = parseCodeList(grid);
  if (!list.found) throw new Error(`Couldn't find a code column and an ISIN (or NSE symbol) column in ${f.name}.`);
  if (!list.entries.length) throw new Error(`${f.name} has the right columns but no codes under them.`);
  const r = await saveCodeList(broker, list.entries);
  return `Saved ${r.saved.toLocaleString("en-IN")} ${broker} codes from ${f.name}${r.unresolved ? ` (${r.unresolved} NSE symbols not found yet; the NSE equity list job adds them)` : ""}. Codes you matched by hand keep your match.`;
}

export async function forgetCodeList(fd: FormData) {
  const { ctx } = await guard();
  const source = String(fd.get("source") ?? "");
  if (!source) return;
  await forgetCodes(source);
  await audit(ctx.user.id, "import.codes.forget", { source });
  revalidatePath("/import");
}

const Row = z.object({
  assetHint: z.enum(["mf", "stock", "etf", "unknown"]), isin: z.string().nullable(), amfiCode: z.string().nullable(), symbol: z.string().nullable(),
  name: z.string().min(1).max(300), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["buy", "sell", "sip", "switch_in", "switch_out", "dividend_payout", "dividend_reinvest", "bonus", "split"]),
  units: z.number().min(0), price: z.number().min(0), amount: z.number().min(0), fees: z.number().min(0),
  account: z.object({ kind: z.enum(["folio", "demat"]), provider: z.string().max(60), ref: z.string().max(80) }),
  dedupKey: z.string().min(1).max(400), note: z.string().max(500).optional(),
  instrumentId: z.number().int().positive().optional(),
});
const Preview = z.object({
  source: z.enum(["cas", "demat_cas", "tradebook", "contract_note", "spreadsheet"]), filename: z.string().max(300),
  rows: z.array(Row).min(1).max(20000), skipped: z.array(z.any()).optional(), warnings: z.array(z.string()).optional(),
});

export type CommitResult = { error: string } | { ok: string; noSymbol: string[]; sips: SipCandidate[] } | null;

export async function commitPreview(_: unknown, payload: string): Promise<CommitResult> {
  try {
    const { ctx, profileId } = await guard();
    const p = Preview.parse(JSON.parse(payload));
    const today = new Date().toISOString().slice(0, 10);
    if (p.rows.some((r) => r.date > today)) return { error: "Some rows have dates in the future; check the file." };
    const r = await commitImport({ ...p, skipped: [], warnings: [] }, profileId, ctx.user.id);
    await audit(ctx.user.id, "import", { profileId, source: p.source, filename: p.filename, inserted: r.inserted, duplicates: r.duplicates });
    revalidatePath("/", "layout");
    // Freshly imported fund history often contains SIPs nobody has set up yet.
    const sips = ctx.features.has("sip") && r.inserted && p.rows.some((x) => x.assetHint === "mf" || x.type === "sip") ? await sipCandidates(profileId) : [];
    return {
      ok: `Saved ${r.inserted} transaction${r.inserted === 1 ? "" : "s"}${r.duplicates ? `, skipped ${r.duplicates} already imported` : ""}${r.newInstruments ? `, added ${r.newInstruments} new instrument${r.newInstruments === 1 ? "" : "s"}` : ""}.`,
      noSymbol: r.noSymbol, sips,
    };
  } catch (e) {
    return { error: e instanceof z.ZodError ? "The preview data was not valid. Re-upload the file." : (e as Error).message };
  }
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Fixed = z.object({
  kind: z.enum(["fd", "rd", "bond", "ppf", "epf", "nps", "sgb", "gold", "reit", "cash", "other"]), name: z.string().min(1).max(120),
  institution: z.string().max(120).nullable(), principal: z.number().min(0), ratePct: z.number().min(0).max(50),
  compounding: z.enum(["monthly", "quarterly", "half_yearly", "yearly", "simple"]), payout: z.boolean(), startDate: iso,
  maturityDate: iso.nullable(), balance: z.number().min(0).nullable(), balanceAsOf: iso.nullable(), assetClass: z.string().max(30).nullable(), notes: z.string().max(500).nullable(),
});
const Loan = z.object({
  name: z.string().min(1).max(120), kind: z.enum(["home", "car", "personal", "education", "gold", "other"]), lender: z.string().max(120).nullable(),
  principal: z.number().min(0), ratePct: z.number().min(0).max(50), tenureMonths: z.number().int().min(0).max(600),
  firstEmiDate: z.union([iso, z.literal("")]), emi: z.number().positive().nullable(),
  events: z.array(z.object({ date: iso, kind: z.enum(["prepayment", "rate_change"]), amount: z.number().positive().nullable(), ratePct: z.number().min(0).max(50).nullable(), reduce: z.enum(["tenure", "emi"]) })).max(500),
});
const Records = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), filename: z.string().max(300), rows: z.array(Fixed).min(1).max(2000) }),
  z.object({ kind: z.literal("loans"), filename: z.string().max(300), rows: z.array(Loan).min(1).max(500) }),
]);

export async function commitRecords(_: unknown, payload: string): Promise<{ error: string } | { ok: string } | null> {
  try {
    const p = Records.parse(JSON.parse(payload));
    const { ctx, profileId } = await guard(p.kind === "fixed" ? "other" : "loans");
    let msg: string;
    if (p.kind === "fixed") {
      const r = await commitFixed(p.rows, profileId, ctx.user.id, p.filename);
      msg = `Added ${r.inserted} holding${r.inserted === 1 ? "" : "s"}${r.duplicates ? `; ${r.duplicates} already there by name, left unchanged` : ""}.`;
    } else {
      const r = await commitLoans(p.rows as LoanRecord[], profileId, ctx.user.id, p.filename);
      msg = `Added ${r.inserted} loan${r.inserted === 1 ? "" : "s"} and ${r.events} prepayment/rate change${r.events === 1 ? "" : "s"}${r.duplicates ? `; ${r.duplicates} loan${r.duplicates === 1 ? "" : "s"} already there, left unchanged` : ""}${r.unknown.length ? `. No loan named ${r.unknown.join(", ")}: its events were skipped` : ""}.`;
    }
    await audit(ctx.user.id, `import.${p.kind}`, { profileId, filename: p.filename, rows: p.rows.length });
    revalidatePath("/", "layout");
    return { ok: msg };
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
