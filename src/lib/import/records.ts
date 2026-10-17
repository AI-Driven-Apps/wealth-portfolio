// Deposits/savings and loans from a spreadsheet, for the phase 5 pages.
// Pure parsing only; commit.ts writes them.
import { detectColumns, readGrids, text, cell, type Aliases } from "./columns";
import { parseLooseDate, parseNumber } from "./tabular";
import type { Compounding, FixedKind } from "@/lib/calc/fixed";

export interface FixedRecord {
  kind: FixedKind; name: string; institution: string | null; principal: number; ratePct: number; compounding: Compounding;
  payout: boolean; startDate: string; maturityDate: string | null; balance: number | null; balanceAsOf: string | null;
  assetClass: string | null; notes: string | null;
}

export interface LoanRecord {
  name: string; kind: "home" | "car" | "personal" | "education" | "gold" | "other"; lender: string | null;
  principal: number; ratePct: number; tenureMonths: number; firstEmiDate: string; emi: number | null;
  events: { date: string; kind: "prepayment" | "rate_change"; amount: number | null; ratePct: number | null; reduce: "tenure" | "emi" }[];
}

export interface RecordsPreview<T> { rows: T[]; skipped: { reason: string; detail: string }[]; warnings: string[] }

const FIXED_ALIASES: Aliases = {
  kind: ["kind", "type", "assettype", "category"],
  name: ["name", "description", "holding", "account", "accountname"],
  institution: ["institution", "bank", "issuer", "provider"],
  principal: ["amount", "principal", "invested", "depositamount", "monthlyinstalment", "instalment"],
  rate: ["rate", "ratepct", "interestrate", "interest", "roi", "coupon"],
  compounding: ["compounding", "frequency", "compoundingfrequency"],
  payout: ["payout", "interestpayout", "interestpaidout"],
  start: ["startdate", "start", "opened", "openedon", "depositdate", "date", "investeddate"],
  maturity: ["maturitydate", "maturity", "matures", "maturityon"],
  balance: ["balance", "currentbalance", "currentvalue", "value"],
  balanceAsOf: ["balanceasof", "asof", "balancedate", "valuedate"],
  assetClass: ["countsas", "assetclass", "class"],
  notes: ["notes", "note", "remarks"],
};

const KIND_WORDS: [RegExp, FixedKind][] = [
  [/^(fd|fixed\s*deposit|term\s*deposit)/i, "fd"], [/^(rd|recurring)/i, "rd"], [/^(bond|ncd|debenture)/i, "bond"],
  [/^ppf/i, "ppf"], [/^(epf|pf|provident)/i, "epf"], [/^nps/i, "nps"], [/^(sgb|sovereign)/i, "sgb"],
  [/^gold/i, "gold"], [/^(reit|invit)/i, "reit"], [/^(cash|savings|sb|bank)/i, "cash"], [/^(property|real\s*estate|flat|house|land|other)/i, "other"],
];
const COMP: Record<string, Compounding> = { monthly: "monthly", quarterly: "quarterly", "half-yearly": "half_yearly", half_yearly: "half_yearly", halfyearly: "half_yearly", yearly: "yearly", annual: "yearly", annually: "yearly", simple: "simple" };
const CLASSES = ["equity", "debt", "gold", "silver", "international", "hybrid", "real_estate", "cash", "other"];
const yes = (s: string) => /^(y|yes|true|1|paid|payout)$/i.test(s.trim());

export function parseFixedSheet(buf: Uint8Array, filename: string): RecordsPreview<FixedRecord> {
  const out: RecordsPreview<FixedRecord> = { rows: [], skipped: [], warnings: [] };
  for (const s of readGrids(buf, filename)) {
    const cm = detectColumns(s.grid, FIXED_ALIASES, [["kind"], ["name"], ["principal", "balance"]]);
    if (!cm) continue;
    for (const row of s.grid.slice(cm.headerRow + 1)) {
      const name = text(row, cm, "name");
      if (!name) continue;
      const kindRaw = text(row, cm, "kind");
      const kind = KIND_WORDS.find(([re]) => re.test(kindRaw))?.[1];
      if (!kind) { out.skipped.push({ reason: `unknown kind "${kindRaw}"`, detail: name }); continue; }
      const isProperty = /property|real\s*estate|flat|house|land/i.test(kindRaw);
      const principal = Math.abs(parseNumber(cell(row, cm, "principal")) ?? 0);
      const balRaw = parseNumber(cell(row, cm, "balance"));
      const balance = balRaw == null ? null : Math.abs(balRaw);
      const startDate = parseLooseDate(cell(row, cm, "start")) ?? (balance != null ? parseLooseDate(cell(row, cm, "balanceAsOf")) : null);
      const maturityDate = parseLooseDate(cell(row, cm, "maturity"));
      if (!startDate) { out.skipped.push({ reason: "no start date", detail: name }); continue; }
      if (!principal && balance == null) { out.skipped.push({ reason: "no amount or balance", detail: name }); continue; }
      if (kind === "rd" && !maturityDate) { out.skipped.push({ reason: "RD needs a maturity date", detail: name }); continue; }
      if (maturityDate && maturityDate <= startDate) { out.skipped.push({ reason: "maturity before start", detail: name }); continue; }
      const compRaw = text(row, cm, "compounding").toLowerCase().replace(/\s+/g, "");
      const cls = text(row, cm, "assetClass").toLowerCase().replace(/\s+/g, "_");
      out.rows.push({
        kind, name: name.slice(0, 120), institution: text(row, cm, "institution").slice(0, 120) || null, principal,
        ratePct: Math.min(Math.abs(parseNumber(cell(row, cm, "rate")) ?? 0), 50),
        compounding: COMP[compRaw] ?? (["ppf", "epf", "nps", "gold", "reit", "other"].includes(kind) ? "yearly" : "quarterly"),
        payout: yes(text(row, cm, "payout")), startDate, maturityDate,
        balance, balanceAsOf: balance == null ? null : parseLooseDate(cell(row, cm, "balanceAsOf")) ?? startDate,
        assetClass: CLASSES.includes(cls) ? cls : isProperty ? "real_estate" : null,
        notes: text(row, cm, "notes").slice(0, 500) || null,
      });
    }
    break;
  }
  if (!out.rows.length && !out.skipped.length) out.warnings.push("No header with kind, name and amount/balance columns found. Download the template.");
  return out;
}

const LOAN_ALIASES: Aliases = {
  loan: ["loan", "name", "loanname"],
  kind: ["kind", "type", "loantype"],
  lender: ["lender", "bank"],
  principal: ["principal", "amount", "loanamount", "sanctioned", "borrowed"],
  rate: ["rate", "ratepct", "interestrate", "interest", "roi"],
  tenure: ["tenuremonths", "tenure", "months", "term"],
  firstEmi: ["firstemidate", "firstemi", "emistart", "startdate", "start"],
  emi: ["emi", "monthlyemi"],
  event: ["event", "eventtype", "change"],
  eventDate: ["eventdate", "date", "on"],
  eventAmount: ["eventamount", "prepayment", "prepaid", "prepaymentamount"],
  newRate: ["newrate", "newratepct", "revisedrate"],
  adjusts: ["lenderadjusts", "adjusts", "reduce"],
};

export function parseLoanSheet(buf: Uint8Array, filename: string): RecordsPreview<LoanRecord> {
  const out: RecordsPreview<LoanRecord> = { rows: [], skipped: [], warnings: [] };
  for (const s of readGrids(buf, filename)) {
    const cm = detectColumns(s.grid, LOAN_ALIASES, [["loan"], ["principal", "event"]]);
    if (!cm) continue;
    const byName = new Map<string, LoanRecord>();
    const pendingEvents: { name: string; ev: LoanRecord["events"][number] }[] = [];
    for (const row of s.grid.slice(cm.headerRow + 1)) {
      const name = text(row, cm, "loan");
      if (!name) continue;
      const event = text(row, cm, "event").toLowerCase();
      if (event) {
        const kind = /pre-?pay|part/.test(event) ? "prepayment" : /rate/.test(event) ? "rate_change" : null;
        const date = parseLooseDate(cell(row, cm, "eventDate"));
        if (!kind || !date) { out.skipped.push({ reason: kind ? "event without date" : `unknown event "${event}"`, detail: name }); continue; }
        const amount = parseNumber(cell(row, cm, "eventAmount")), newRate = parseNumber(cell(row, cm, "newRate"));
        if (kind === "prepayment" && !(amount && amount > 0)) { out.skipped.push({ reason: "prepayment without amount", detail: `${name} ${date}` }); continue; }
        if (kind === "rate_change" && newRate == null) { out.skipped.push({ reason: "rate change without new rate", detail: `${name} ${date}` }); continue; }
        pendingEvents.push({ name: name.toLowerCase(), ev: { date, kind, amount: kind === "prepayment" ? Math.abs(amount!) : null, ratePct: kind === "rate_change" ? Math.abs(newRate!) : null, reduce: /emi/i.test(text(row, cm, "adjusts")) ? "emi" : "tenure" } });
        continue;
      }
      const principal = Math.abs(parseNumber(cell(row, cm, "principal")) ?? 0);
      const ratePct = Math.abs(parseNumber(cell(row, cm, "rate")) ?? NaN);
      const tenureRaw = text(row, cm, "tenure");
      // "20y" / "20 years" → months
      const tenureMonths = Math.round(/y/i.test(tenureRaw) ? (parseNumber(tenureRaw.replace(/[^\d.]/g, "")) ?? 0) * 12 : parseNumber(tenureRaw) ?? 0);
      const firstEmiDate = parseLooseDate(cell(row, cm, "firstEmi"));
      if (!principal || !Number.isFinite(ratePct) || !tenureMonths || !firstEmiDate) { out.skipped.push({ reason: "need principal, rate, tenure and first EMI date", detail: name }); continue; }
      const kindRaw = text(row, cm, "kind").toLowerCase();
      const kind = (["home", "car", "personal", "education", "gold"].find((k) => kindRaw.includes(k)) ?? "other") as LoanRecord["kind"];
      const emi = parseNumber(cell(row, cm, "emi"));
      const rec: LoanRecord = { name: name.slice(0, 120), kind, lender: text(row, cm, "lender").slice(0, 120) || null, principal, ratePct: Math.min(ratePct, 50), tenureMonths: Math.min(tenureMonths, 600), firstEmiDate, emi: emi && emi > 0 ? emi : null, events: [] };
      byName.set(name.toLowerCase(), rec);
      out.rows.push(rec);
    }
    // Events may refer to loans in this file or ones already saved (resolved at commit).
    for (const p of pendingEvents) {
      const l = byName.get(p.name);
      if (l) l.events.push(p.ev);
      else out.rows.push({ name: p.name, kind: "other", lender: null, principal: 0, ratePct: 0, tenureMonths: 0, firstEmiDate: "", emi: null, events: [p.ev] });
    }
    break;
  }
  if (!out.rows.length && !out.skipped.length) out.warnings.push("No header with a loan column and principal or event columns found. Download the template.");
  return out;
}

export const FIXED_TEMPLATE = [
  "kind,name,institution,amount,rate,compounding,payout,start_date,maturity_date,balance,balance_as_of,counts_as,notes",
  "FD,SBI FD 2 years,SBI,200000,7.1,quarterly,no,2025-06-10,2027-06-10,,,,",
  "RD,HDFC RD,HDFC Bank,5000,6.8,quarterly,no,2025-01-05,2027-01-05,,,,amount = monthly instalment",
  "PPF,PPF account,Post Office,,7.1,yearly,,2016-04-01,2031-04-01,650000,2026-04-01,,",
  "EPF,EPF,EPFO,,8.25,yearly,,2018-07-01,,340000,2026-03-31,,",
  "Gold,Gold coins,,,0,yearly,,2020-11-14,,180000,2026-10-01,,revalue occasionally",
  "Cash,Savings account,ICICI Bank,,3,quarterly,,2019-01-01,,150000,2026-10-01,,",
  "Property,Flat in Pune,,,5,yearly,,2021-07-15,,5200000,2026-09-30,real_estate,",
].join("\n");

export const LOAN_TEMPLATE = [
  "loan,kind,lender,principal,rate,tenure_months,first_emi_date,emi,event,event_date,event_amount,new_rate,lender_adjusts",
  "Home loan,home,HDFC Bank,3500000,8.6,240,2021-08-05,,,,,,",
  "Home loan,,,,,,,,prepayment,2024-03-15,300000,,tenure",
  "Home loan,,,,,,,,rate change,2025-06-01,,8.4,emi",
  "Car loan,car,ICICI Bank,600000,9.2,60,2023-04-10,12513,,,,,",
].join("\n");
