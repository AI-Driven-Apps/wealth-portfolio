import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth/session";
import { TXN_TEMPLATE } from "@/lib/import/spreadsheet";
import { FIXED_TEMPLATE, LOAN_TEMPLATE } from "@/lib/import/records";

export const dynamic = "force-dynamic";

const FILES: Record<string, { name: string; body: string }> = {
  transactions: { name: "wealth-portfolio-transactions.csv", body: TXN_TEMPLATE },
  fixed: { name: "wealth-portfolio-deposits.csv", body: FIXED_TEMPLATE },
  loans: { name: "wealth-portfolio-loans.csv", body: LOAN_TEMPLATE },
};

/** CSV templates for the spreadsheet importers (example rows included). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await getCtx())) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const f = FILES[(await params).kind];
  if (!f) return NextResponse.json({ error: "unknown template" }, { status: 404 });
  return new NextResponse(f.body + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f.name}"` } });
}
