import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { todayIST } from "@/lib/calc/dates";
import { visibleTypes } from "@/lib/portfolio/scope";
import { PageHeader, Card, Badge, Empty, Notice } from "@/components/ui";
import { money, fmtDate, fmtUnits, fmtPrice } from "@/lib/format";
import { AddTxnForm } from "./add-form";

export const metadata = { title: "Transactions" };
const LABEL: Record<string, string> = { buy: "Buy", sell: "Sell", sip: "SIP", switch_in: "Switch in", switch_out: "Switch out", dividend_payout: "Dividend", dividend_reinvest: "Div. reinvest", bonus: "Bonus", split: "Split" };
const PAGE = 100;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const types = visibleTypes(ctx);
  const page = Math.max(1, Number(sp.page) || 1);
  const assetFilter = types.includes(sp.type as never) ? [sp.type as (typeof types)[number]] : types;
  const where = ctx.profileIds.length && assetFilter.length
    ? and(inArray(schema.txn.profileId, ctx.profileIds), inArray(schema.instrument.type, assetFilter)) : sql`false`;
  const rows = await db.select({ t: schema.txn, ins: schema.instrument, profile: schema.profile.name })
    .from(schema.txn)
    .innerJoin(schema.instrument, eq(schema.instrument.id, schema.txn.instrumentId))
    .innerJoin(schema.profile, eq(schema.profile.id, schema.txn.profileId))
    .where(where).orderBy(desc(schema.txn.date), desc(schema.txn.createdAt)).limit(PAGE + 1).offset((page - 1) * PAGE);
  const more = rows.length > PAGE;
  const canAdd = ctx.canManage && ctx.scope !== "household" && !!ctx.scope;

  return (
    <>
      <PageHeader title="Transactions" sub="Everything that moves units in or out. Imported rows can be undone per import; manual rows can be deleted on the holding page." />
      <Card title="Add a transaction" className="mb-4">
        {canAdd ? <AddTxnForm basePath={config.basePath} today={todayIST()} /> : <Notice kind="info">{ctx.scope === "household" ? "Switch to a single profile to add transactions." : "You have view-only access to this profile."}</Notice>}
      </Card>
      <div className="mb-3 flex flex-wrap gap-1.5 text-[13px]">
        {[{ k: "", l: "All" }, ...types.map((t) => ({ k: t, l: t === "mf" ? "Mutual funds" : t === "stock" ? "Stocks" : "ETFs" }))].map((f) => (
          <Link key={f.k} href={f.k ? `/transactions?type=${f.k}` : "/transactions"} className={`rounded-md px-2.5 py-1 ${(sp.type ?? "") === f.k ? "bg-accent-soft font-semibold text-accent" : "text-ink-2 hover:bg-panel-2"}`}>{f.l}</Link>
        ))}
      </div>
      {!rows.length ? <Empty title="No transactions yet" /> : (
        <Card pad={false}>
          <div className="overflow-x-auto"><table>
            <thead><tr><th>Date</th><th>Holding</th><th>Type</th>{ctx.scope === "household" && <th>Profile</th>}<th className="r">Units</th><th className="r">Price</th><th className="r">Amount</th><th>Source</th></tr></thead>
            <tbody>{rows.slice(0, PAGE).map(({ t, ins, profile }) => (
              <tr key={t.id} className="hover:bg-panel-2">
                <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
                <td className="max-w-[340px]"><Link href={`/holding/${ins.id}`} className="block truncate hover:underline">{ins.type === "mf" ? ins.name : `${ins.nseSymbol} · ${ins.name}`}</Link></td>
                <td>{LABEL[t.type]}</td>
                {ctx.scope === "household" && <td className="text-ink-2">{profile}</td>}
                <td className="r num">{t.type === "split" ? `×${Number(t.units)}` : fmtUnits(Number(t.units))}</td>
                <td className="r num">{Number(t.price) ? fmtPrice(Number(t.price)) : "—"}</td>
                <td className="r num">{money(Number(t.amount), true)}</td>
                <td><Badge>{t.source.replace("_", " ")}</Badge></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
      <div className="mt-3 flex gap-3 text-[13px]">
        {page > 1 && <Link className="underline" href={`/transactions?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), page: String(page - 1) })}`}>← Newer</Link>}
        {more && <Link className="underline" href={`/transactions?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), page: String(page + 1) })}`}>Older →</Link>}
      </div>
    </>
  );
}
