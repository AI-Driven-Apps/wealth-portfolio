import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { addMonths, todayIST } from "@/lib/calc/dates";
import { PageHeader, Card, Badge, btnDanger } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { fmtMonth } from "@/lib/format";
import { deleteDisclosure, uploadDisclosure } from "../actions";

export const metadata = { title: "Fund disclosures" };

export default async function DisclosuresPage() {
  await requireAdmin();
  // Funds and ETFs anyone holds, plus the underlying funds that fund-of-funds point at.
  const funds = await db.select().from(schema.instrument).where(and(
    inArray(schema.instrument.type, ["mf", "etf"]),
    sql`${schema.instrument.id} in (select instrument_id from txn union select holding_instrument_id from fund_holding where kind = 'fund' and holding_instrument_id is not null)`,
  )).orderBy(asc(schema.instrument.name));
  const months = funds.length ? await db.select({
    fundId: schema.fundHolding.fundId, m: schema.fundHolding.asOfMonth,
    n: sql<number>`count(*)::int`, w: sql<string>`sum(greatest(${schema.fundHolding.weightPct}, 0))`,
  }).from(schema.fundHolding).where(inArray(schema.fundHolding.fundId, funds.map((f) => f.id)))
    .groupBy(schema.fundHolding.fundId, schema.fundHolding.asOfMonth).orderBy(sql`${schema.fundHolding.asOfMonth} desc`) : [];
  const stale = addMonths(todayIST(), -2).slice(0, 7) + "-01";
  const [cap] = await db.select().from(schema.appSetting).where(eq(schema.appSetting.key, "amfi_cap_list"));
  const capInfo = cap?.value as { rows: number; at: string } | undefined;

  return (
    <>
      <PageHeader title="Fund disclosures" sub="Each AMC publishes every scheme's full portfolio within ~10 days of month end (SEBI rule). Upload one per fund for look-through; re-uploading a month replaces it." />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Upload a disclosure">
          <ActionForm action={uploadDisclosure} submit="Upload" className="space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="fundId">Fund or ETF</label>
              <select id="fundId" name="fundId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><label htmlFor="month">Disclosure month</label><input id="month" name="month" type="month" defaultValue={addMonths(todayIST(), -1).slice(0, 7)} /></div>
              <div className="flex flex-col gap-1"><label htmlFor="sheet">Sheet name (optional)</label><input id="sheet" name="sheet" placeholder="found from the fund's name" /></div>
            </div>
            <div className="flex flex-col gap-1"><label htmlFor="file">File</label><input id="file" name="file" type="file" accept=".xlsx,.xls,.csv" required /></div>
          </ActionForm>
        </Card>
        <Card title="Accepted layouts">
          <ul className="space-y-2 text-[13px] text-ink-2">
            <li><b className="text-ink">AMC monthly portfolio xlsx</b>: the sheet with the fund's name is picked automatically. Columns are read by header: instrument name, ISIN, industry/rating, and % to NAV.</li>
            <li><b className="text-ink">Plain CSV</b>: <code>name, isin, weight</code>, optionally <code>sector</code> and <code>type</code> (equity / debt / fund / cash). Weights may be percent or fractions.</li>
            <li><b className="text-ink">Fund of funds</b>: lines that are other schemes (INF… ISINs) link to those schemes; upload their disclosures too for a second level.</li>
            <li><b className="text-ink">Index ETFs</b>: the index's published constituents work the same way.</li>
          </ul>
          <p className="mt-3 text-[12px] text-ink-3">AMFI cap list: {capInfo ? `${capInfo.rows.toLocaleString("en-IN")} companies, loaded ${new Date(capInfo.at).toLocaleDateString("en-IN")}` : "not loaded yet"} (Admin → Data sources).</p>
        </Card>
      </div>

      <Card title="Funds held" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">{funds.length}</span>}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>Fund / ETF</th><th>Latest</th><th className="r">Lines</th><th className="r">Weights</th><th>Earlier months</th><th /></tr></thead>
          <tbody>{funds.map((f) => {
            const ms = months.filter((m) => m.fundId === f.id);
            const last = ms[0];
            return (
              <tr key={f.id}>
                <td className="max-w-[360px]"><div className="truncate font-medium">{f.name}</div><div className="text-[11px] text-ink-3">{f.type.toUpperCase()}{f.isFof ? " · fund of funds" : ""}{f.amc ? ` · ${f.amc}` : ""}</div></td>
                <td>{last ? <span className="flex items-center gap-1.5">{fmtMonth(last.m)}{last.m < stale && <Badge kind="warn">stale</Badge>}</span> : <Badge kind="warn">none</Badge>}</td>
                <td className="r num">{last?.n ?? "—"}</td>
                <td className="r num">{last ? `${Number(last.w).toFixed(1)}%` : "—"}</td>
                <td className="text-[12px] text-ink-3">{ms.slice(1, 5).map((m) => fmtMonth(m.m)).join(", ") || "—"}</td>
                <td className="r">{last && <form action={deleteDisclosure}><input type="hidden" name="fundId" value={f.id} /><input type="hidden" name="month" value={last.m} /><button className={btnDanger} title={`Delete the ${fmtMonth(last.m)} disclosure`}>Delete latest</button></form>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>
    </>
  );
}
