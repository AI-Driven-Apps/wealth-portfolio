import { and, asc, inArray, isNull, or, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { dhanTokenStatus } from "@/lib/providers/dhan";
import { PageHeader, Card, Badge, Notice, btnGhost } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { fmtDate } from "@/lib/format";
import { saveDhanToken, uploadCapList, uploadSectors, updateInstrument } from "../actions";

export const metadata = { title: "Data sources" };

export default async function DataPage() {
  await requireAdmin();
  const dhan = config.isVercel ? null : await dhanTokenStatus();
  // Held stocks/ETFs with missing classification, for quick fixes.
  const gaps = await db.select().from(schema.instrument)
    .where(and(
      inArray(schema.instrument.id, sql`(select distinct instrument_id from txn)`),
      inArray(schema.instrument.type, ["stock", "etf"]),
      or(isNull(schema.instrument.nseSymbol), and(sql`${schema.instrument.type} = 'stock'`, or(isNull(schema.instrument.sector), isNull(schema.instrument.capClass))), and(sql`${schema.instrument.type} = 'etf'`, isNull(schema.instrument.underlyingClass))),
    )).orderBy(asc(schema.instrument.name)).limit(100);
  const [counts] = await db.execute<{ mf: number; stock: number; etf: number }>(sql`select count(*) filter (where type='mf')::int mf, count(*) filter (where type='stock')::int stock, count(*) filter (where type='etf')::int etf from instrument`);

  return (
    <>
      <PageHeader title="Data sources" sub={`Instrument master: ${counts.mf.toLocaleString("en-IN")} mutual funds, ${counts.stock.toLocaleString("en-IN")} stocks, ${counts.etf.toLocaleString("en-IN")} ETFs.`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Where prices come from">
          <ul className="space-y-2 text-[13px]">
            <li><b>Mutual fund NAV</b> — AMFI's daily NAVAll file (all schemes, ~11 pm IST), history from mfapi.in.</li>
            <li><b>Stock and ETF prices</b> — Yahoo Finance end-of-day, re-fetched over a rolling window so split/dividend adjustments never mix scales.</li>
            <li><b>Live quotes</b> — {config.isVercel ? "Pi only (needs the worker's 5-minute schedule)." : "Dhan, read-only, every 5 minutes in market hours (needs a Data API subscription)."}</li>
            <li><b>Cap class</b> — AMFI's half-yearly market-cap list, uploaded below.</li>
            <li><b>Sector</b> — Yahoo's company profile, or your own CSV below.</li>
          </ul>
        </Card>
        {!config.isVercel && (
          <Card title="Dhan access token" actions={dhan?.configured ? <Badge kind={dhan.hoursRemaining > 2 ? "accent" : "warn"}>{dhan.hoursRemaining.toFixed(1)} h left</Badge> : <Badge>not set</Badge>}>
            {!config.dhanClientId && <div className="mb-3"><Notice>Set DHAN_CLIENT_ID in the server's .env first.</Notice></div>}
            <p className="mb-3 text-[13px] text-ink-2">Tokens last 24 hours. Generate one at web.dhan.co → My Profile → Access DhanHQ APIs and paste it here. Without it, prices fall back to end-of-day.</p>
            <ActionForm action={saveDhanToken} submit="Save token" className="space-y-3">
              <input name="token" type="password" autoComplete="off" placeholder="Paste access token" className="w-full" aria-label="Dhan access token" />
            </ActionForm>
          </Card>
        )}
        <Card title="AMFI market-cap list">
          <p className="mb-3 text-[13px] text-ink-2">Download the latest "Average Market Capitalization" xlsx from amfiindia.com (published in January and July) and upload it. Stocks are matched by ISIN.</p>
          <ActionForm action={uploadCapList} submit="Upload list" className="space-y-3"><input name="file" type="file" accept=".xlsx,.xls" required /></ActionForm>
        </Card>
        <Card title="Sector overrides">
          <p className="mb-3 text-[13px] text-ink-2">CSV or XLSX with a <code>sector</code> column and a <code>symbol</code> or <code>isin</code> column. Overrides Yahoo's sector.</p>
          <ActionForm action={uploadSectors} submit="Upload sectors" className="space-y-3"><input name="file" type="file" accept=".csv,.xlsx,.xls" required /></ActionForm>
        </Card>
      </div>
      <Card title="Holdings missing details" className="mt-4" pad={false} actions={<span className="text-[12px] text-ink-3">{gaps.length}</span>}>
        {!gaps.length ? <p className="px-4 py-5 text-ink-3">Every stock and ETF you hold has a symbol, sector and class.</p> : (
          <div className="overflow-x-auto"><table>
            <thead><tr><th>Instrument</th><th>NSE symbol</th><th>Sector</th><th>Cap</th><th>Holds</th><th /></tr></thead>
            <tbody>{gaps.map((g) => (
              <tr key={g.id}>
                <td className="max-w-[260px]"><div className="truncate font-medium">{g.name}</div><div className="text-[11px] text-ink-3">{g.type.toUpperCase()} · {g.isin ?? "no ISIN"} · price {fmtDate(g.lastPriceDate)}</div></td>
                <td colSpan={5}>
                  <form action={updateInstrument} className="flex flex-wrap gap-1.5">
                    <input type="hidden" name="id" value={g.id} />
                    <input name="nseSymbol" defaultValue={g.nseSymbol ?? ""} placeholder="SYMBOL" className="w-28" aria-label="NSE symbol" />
                    <input name="sector" defaultValue={g.sector ?? ""} placeholder="Sector" className="w-36" aria-label="Sector" disabled={g.type !== "stock"} />
                    <select name="capClass" defaultValue={g.capClass ?? ""} aria-label="Cap class" disabled={g.type !== "stock"}><option value="">—</option><option value="large">Large</option><option value="mid">Mid</option><option value="small">Small</option></select>
                    <select name="underlyingClass" defaultValue={g.underlyingClass ?? (g.type === "stock" ? "equity" : "")} aria-label="Underlying"><option value="">—</option>{["equity", "debt", "liquid", "hybrid", "gold", "silver", "international", "other"].map((u) => <option key={u} value={u}>{u}</option>)}</select>
                    <button className={btnGhost}>Save</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
