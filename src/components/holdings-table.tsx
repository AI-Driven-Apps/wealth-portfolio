import Link from "next/link";
import type { ReactNode } from "react";
import type { Holding, Totals } from "@/lib/portfolio/holdings";
import { money, pct, fmtPrice, fmtUnits, fmtDate, tone, signedMoney } from "@/lib/format";
import { Badge } from "./ui";

export interface ExtraCol { header: string; cell: (h: Holding) => ReactNode; right?: boolean; title?: string }

/** One table for funds, stocks and ETFs; pages add their own columns. */
export function HoldingsTable({ holdings, totals, extra = [], priceLabel = "Price", showProfileNote }: {
  holdings: Holding[]; totals?: Totals; extra?: ExtraCol[]; priceLabel?: string; showProfileNote?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Holding</th>
            {extra.map((c) => <th key={c.header} className={c.right ? "r" : ""} title={c.title}>{c.header}</th>)}
            <th className="r">Units</th>
            <th className="r">Avg cost</th>
            <th className="r">{priceLabel}</th>
            <th className="r">Invested</th>
            <th className="r">Value</th>
            <th className="r">P/L</th>
            <th className="r" title="Annualised return on your actual cash flows">XIRR</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr key={h.instrument.id} className="hover:bg-panel-2">
              <td className="max-w-[340px]">
                <Link href={`/holding/${h.instrument.id}`} className="block truncate font-medium hover:underline">{h.instrument.nseSymbol && h.instrument.type !== "mf" ? h.instrument.nseSymbol : h.instrument.name}</Link>
                <div className="flex items-center gap-1.5 truncate text-[12px] text-ink-3">
                  {h.instrument.type !== "mf" && h.instrument.nseSymbol ? <span className="truncate">{h.instrument.name}</span> : <span className="truncate">{h.instrument.schemeCategory ?? h.instrument.amc}</span>}
                  {h.instrument.plan === "regular" && <Badge kind="warn" title="Regular plans pay distributor commission through a higher expense ratio">Regular</Badge>}
                  {h.position.warnings.length > 0 && <Badge kind="loss" title={h.position.warnings.join("\n")}>Check</Badge>}
                </div>
              </td>
              {extra.map((c) => <td key={c.header} className={c.right ? "r num" : ""}>{c.cell(h)}</td>)}
              <td className="r num">{fmtUnits(h.position.units)}</td>
              <td className="r num">{fmtPrice(h.position.avgCost)}</td>
              <td className="r num">
                {fmtPrice(h.price)}
                <div className="text-[11px] text-ink-3">{fmtDate(h.priceDate)}</div>
              </td>
              <td className="r num">{money(h.position.invested)}</td>
              <td className="r num font-medium">{money(h.value)}</td>
              <td className={`r num ${tone(h.unrealized)}`}>
                {signedMoney(h.unrealized)}
                <div className="text-[11px]">{pct(h.unrealizedPct, 1, true)}</div>
              </td>
              <td className={`r num ${tone(h.xirr)}`} title={h.xirr == null ? "Shown after 30 days of history" : undefined}>{pct(h.xirr, 1)}</td>
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              <td>Total{showProfileNote ? " (selected profiles)" : ""}</td>
              {extra.map((c) => <td key={c.header} />)}
              <td /><td /><td />
              <td className="r num">{money(totals.invested)}</td>
              <td className="r num">{money(totals.value)}</td>
              <td className={`r num ${tone(totals.unrealized)}`}>{signedMoney(totals.unrealized)}</td>
              <td className={`r num ${tone(totals.xirr)}`}>{pct(totals.xirr, 1)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function ClosedPositions({ holdings }: { holdings: Holding[] }) {
  const closed = holdings.filter((h) => h.position.units === 0);
  if (!closed.length) return null;
  return (
    <details className="mt-4 rounded-xl border border-line bg-panel">
      <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">Closed positions ({closed.length})</summary>
      <div className="overflow-x-auto border-t border-line">
        <table>
          <thead><tr><th>Holding</th><th className="r">Realised P/L</th><th className="r">Dividends</th><th className="r">XIRR</th></tr></thead>
          <tbody>
            {closed.map((h) => (
              <tr key={h.instrument.id}>
                <td><Link href={`/holding/${h.instrument.id}`} className="hover:underline">{h.instrument.nseSymbol ?? h.instrument.name}</Link></td>
                <td className={`r num ${tone(h.position.realized)}`}>{signedMoney(h.position.realized)}</td>
                <td className="r num">{money(h.position.dividends)}</td>
                <td className={`r num ${tone(h.xirr)}`}>{pct(h.xirr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
