"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireCtx, writableProfile } from "@/lib/auth/session";
import { todayIST } from "@/lib/calc/dates";
import { audit } from "@/lib/audit";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const LoanInput = z.object({
  kind: z.enum(["home", "car", "personal", "education", "gold", "other"]),
  name: z.string().trim().min(1).max(120),
  lender: z.string().trim().max(120).optional(),
  principal: z.coerce.number().positive(),
  ratePct: z.coerce.number().min(0).max(50),
  tenureMonths: z.coerce.number().int().min(1).max(600),
  emi: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  firstEmiDate: iso,
});

export async function addLoan(_: unknown, fd: FormData) {
  try {
    const ctx = await requireCtx("loans");
    const profileId = writableProfile(ctx);
    const v = LoanInput.parse(Object.fromEntries(fd));
    const [row] = await db.insert(schema.loan).values({
      profileId, kind: v.kind, name: v.name, lender: v.lender || null, principal: v.principal.toFixed(2), ratePct: v.ratePct.toFixed(3),
      tenureMonths: v.tenureMonths, emi: v.emi ? Number(v.emi).toFixed(2) : null, firstEmiDate: v.firstEmiDate,
    }).returning({ id: schema.loan.id });
    await audit(ctx.user.id, "loan.add", { profileId, id: row.id });
    revalidatePath("/", "layout");
    return { ok: `Added ${v.name}.` };
  } catch (e) {
    return { error: e instanceof z.ZodError ? "Enter the amount, rate, tenure (months) and first EMI date." : (e as Error).message };
  }
}

async function ownedLoan(id: string) {
  const ctx = await requireCtx("loans");
  if (!ctx.canManage) throw new Error("View-only access.");
  const [l] = await db.select().from(schema.loan).where(and(eq(schema.loan.id, id), inArray(schema.loan.profileId, ctx.profileIds)));
  if (!l) throw new Error("Loan not found.");
  return { ctx, loan: l };
}

const EventInput = z.object({
  loanId: z.string().uuid(),
  date: iso,
  kind: z.enum(["prepayment", "rate_change"]),
  amount: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  ratePct: z.union([z.coerce.number().min(0).max(50), z.literal("")]).optional(),
  reduce: z.enum(["tenure", "emi"]).default("tenure"),
});

export async function addLoanEvent(_: unknown, fd: FormData) {
  try {
    const v = EventInput.parse(Object.fromEntries(fd));
    const { ctx, loan } = await ownedLoan(v.loanId);
    if (v.kind === "prepayment" && !v.amount) return { error: "Enter the prepayment amount." };
    if (v.kind === "rate_change" && (v.ratePct === "" || v.ratePct == null)) return { error: "Enter the new interest rate." };
    if (v.date < loan.firstEmiDate.slice(0, 7) + "-01") return { error: "That's before the loan's first EMI." };
    await db.insert(schema.loanEvent).values({
      loanId: loan.id, date: v.date, kind: v.kind, reduce: v.reduce,
      amount: v.kind === "prepayment" ? Number(v.amount).toFixed(2) : null,
      ratePct: v.kind === "rate_change" ? Number(v.ratePct).toFixed(3) : null,
    });
    await audit(ctx.user.id, "loan.event", { loanId: loan.id, kind: v.kind, date: v.date });
    revalidatePath("/", "layout");
    return { ok: v.kind === "prepayment" ? "Prepayment recorded." : "Rate change recorded." };
  } catch (e) {
    return { error: e instanceof z.ZodError ? "Check the date and amount." : (e as Error).message };
  }
}

export async function deleteLoanEvent(fd: FormData) {
  const { ctx, loan } = await ownedLoan(String(fd.get("loanId")));
  const id = String(fd.get("id"));
  await db.delete(schema.loanEvent).where(and(eq(schema.loanEvent.id, id), eq(schema.loanEvent.loanId, loan.id)));
  await audit(ctx.user.id, "loan.event.delete", { loanId: loan.id, id });
  revalidatePath("/", "layout");
}

/** Closed early (foreclosed / refinanced): stops counting as owed from today. */
export async function closeLoan(fd: FormData) {
  const { ctx, loan } = await ownedLoan(String(fd.get("id")));
  const reopen = fd.get("reopen") === "1";
  await db.update(schema.loan).set({ closedOn: reopen ? null : todayIST() }).where(eq(schema.loan.id, loan.id));
  await audit(ctx.user.id, reopen ? "loan.reopen" : "loan.close", { id: loan.id });
  revalidatePath("/", "layout");
}

export async function deleteLoan(fd: FormData) {
  const { ctx, loan } = await ownedLoan(String(fd.get("id")));
  await db.delete(schema.loan).where(eq(schema.loan.id, loan.id));
  await audit(ctx.user.id, "loan.delete", { id: loan.id });
  revalidatePath("/", "layout");
}
