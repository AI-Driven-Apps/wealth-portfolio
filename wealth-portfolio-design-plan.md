# Wealth Portfolio — Design Plan

Oct 16, 2026 · @Sathya

## Overview

Wealth Portfolio is one codebase that tracks every household asset and liability — equity, ETFs, mutual funds, SIPs, fund of funds, bonds/FD/RD, loans and EMIs — and rolls them into a single net-worth view. It ships two ways: a Docker Compose stack on the Raspberry Pi 5 (with AI agents) and a Vercel deployment (no AI agents).

Goals, in order of priority:

1. **Accurate numbers first** — invested value, current value, P/L, XIRR and CAGR per holding, per asset class and overall.
2. **Real diversification** — look through each mutual fund and FoF into its stocks, so large/mid/small-cap and sector exposure is computed across direct equity and funds together.
3. **Decision support** — NAV vs history, what-if comparison against alternatives, and (Pi only) agent commentary from the equity-research agents.
4. **Household use** — multiple profiles, admin-controlled features, Discord alerts per user or global.

Non-goals for v1: placing orders, tax filing, or any broker write access. Execution stays manual, consistent with NSE-Signal.

## Architecture

One repo, one Next.js app (UI and API route handlers); the deploy target only changes how scheduled jobs run and whether the agent module is loaded. Stack matches the Finance Tracker in shape (typed API, Postgres, JWT sessions, nightly backups) but runs natively on Vercel and as a plain Node container on the Pi: **Next.js (App Router) + TypeScript + Drizzle ORM and migrations**, **Tailwind + shadcn/ui + Recharts**, **PostgreSQL 16**.

&#91;embedded content: deployment architecture · Pi vs Vercel\]

Both targets run the same API and job code; the Pi adds the agents container, Vercel swaps APScheduler for Vercel Cron.

| Concern | Raspberry Pi (Docker Compose) | Vercel |
| --- | --- | --- |
| UI + API | `app` container: Next.js `standalone` Node server | Next.js on Vercel (static assets + route handlers) |
| Database | Existing `shared-postgres`, new database `wealth_portfolio` | Managed Postgres (Neon or Supabase), seeded with sample data |
| Scheduled jobs | `worker` container (same image, node-cron) | Vercel Cron calling `/api/cron/*` |
| CAS parsing | `cas-parser` container (Python, casparser) | `api/cas.py` on Vercel's Python runtime |
| AI agents | `agents` container, Compose profile `ai` | Not packaged; agent routes disabled |
| Ingress | Caddy path, e.g. `home.tinyserverlab.in/wealth` | Vercel domain |
| Secrets | `.env` on the Pi | Vercel environment variables |

Design rules that make the dual target work:

- **Jobs are plain functions.** `lib/jobs/navSync.ts`, `lib/jobs/priceSync.ts` etc. are called by the `worker` container on the Pi and by `app/api/cron/[job]/route.ts` on Vercel (guarded by `CRON_SECRET`). Each job is incremental and idempotent so it fits inside a serverless time limit.
- **One switch.** `DEPLOY_TARGET=pi|vercel` sets defaults; `AI_AGENTS_ENABLED` is forced `false` when the target is `vercel`, and agent routes return 404 there.
- **One Python exception: PDF parsing.** casparser has no TypeScript equal, and password-protected broker contract-note PDFs parse best with pdfplumber, so both run as an isolated stateless function the app posts the PDF and password to, getting JSON back. Nothing is stored.
- **Portable by design.** `output: 'standalone'` builds a plain Node server, so the same image also runs on any VPS. Core code uses no Vercel-only services (no Vercel KV or Blob).
- **No local disk assumptions.** Uploads are parsed in memory and discarded; nothing depends on a writable filesystem.
- **Memory budget on the Pi:** `app` ≤ 384 MB, `worker` ≤ 256 MB, `cas-parser` ≤ 96 MB, `agents` ≤ 512 MB, so it sits alongside Finance Tracker, Home Inventory and NSE-Signal.

One Vercel caveat: on the Hobby plan, cron jobs run at most once a day and may fire anywhere within the scheduled hour. That is fine for end-of-day NAV and price sync, but intraday refresh on Vercel has to be on-demand (fetch when a page loads, cache for 15 minutes) rather than scheduled.

**Vercel runs on sample data for now.** A seed script loads a fictional household (two profiles, a few funds and stocks, an FD and a loan), and CAS upload and broker connections are switched off there. Turning it into a secondary real deployment later is a config change plus a Mumbai-region database.

## Data sources

NAV and prices are easy and free; fund holdings (needed for large/mid-cap and sector look-through) are the hard part and need a pluggable provider.

| Data | Source | Refresh | Notes |
| --- | --- | --- | --- |
| MF scheme master + latest NAV | AMFI `NAVAll.txt` | Daily, \~23:00 IST | Authoritative scheme codes and ISINs |
| MF NAV history | [mfapi.in](https://www.mfapi.in) | On add, then daily delta | Free, no key; supports `startDate`/`endDate` filters, so only fetch the missing range |
| Equity EOD prices | Yahoo Finance via yahoo-finance2 (npm) | Daily after close | Clone NSE-Signal's incremental ingestion code and port it to TypeScript; never calls the running NSE-Signal app |
| Equity live quotes (Pi) | Dhan API (own client and credentials, cloned from NSE-Signal's code) | On demand | Read-only; Zerodha later as a second provider |
| MF portfolio holdings | AMC monthly portfolio disclosures (Excel) | Monthly | SEBI requires monthly disclosure within \~10 days of month end; start with a generic CSV upload, then add a per-AMC parser as you invest in each AMC |
| Market-cap class of each stock | AMFI half-yearly large/mid/small-cap list | Jan and Jul | Ranks 1–100 large, 101–250 mid, rest small; the same rule SEBI uses for fund categories |
| Sector of each stock | NSE industry classification | Quarterly | Store on the instrument table |
| Transactions import | CAS PDF via [casparser](https://pypi.org/project/casparser/) | On upload | Parses CAMS/KFintech MF statements and NSDL/CDSL demat CAS; must be the original emailed PDF, not a re-print; the one Python component |
| Bonds, FD, RD, loans | Manual entry | — | Values computed from rate, compounding and tenure |
| Broker trades | Tradebook XLS/XLSX/CSV (SheetJS in TypeScript) and contract-note PDF (Python parser) | On upload | One column-mapping profile per broker layout; PDF password (usually PAN-based) asked at upload and never stored |
| ETF price, iNAV and holdings | Price like a stock (Yahoo Finance, Dhan on the Pi); iNAV and portfolio from the AMC's ETF disclosure; index ETFs can use the index's published constituents | Price daily; holdings monthly | Same HoldingsProvider as MF; tracking difference computed from ETF price vs index history |

Avoid scraping third-party fund sites (Value Research, Morningstar, Tickertape); their terms forbid it and layouts change without notice. If AMC parsing becomes a chore, a paid holdings feed can drop in behind the same `HoldingsProvider` interface later.

## Feature modules

Each module is a feature flag the admin can switch on per user; every module writes to the same transactions ledger so the consolidated view is just a query.

| Module | What it shows | Key interactions |
| --- | --- | --- |
| Equity | Holdings by stock, avg cost, LTP, day change, unrealised and realised P/L, XIRR, sector and market-cap split | Add trade, import tradebook (XLS/XLSX/CSV), contract notes (PDF) or demat CAS, corporate actions (split, bonus, dividend) |
| ETFs | Units, avg cost, LTP vs iNAV (premium/discount), P/L, XIRR, tracking difference vs its index; grouped by underlying (equity index, gold, silver, debt/liquid, international) | Bought and imported exactly like stocks (tradebook, contract note, demat CAS); allocation and look-through follow the underlying, not the "equity" exchange label |
| Mutual funds | Units, avg NAV, current value, P/L, XIRR, CAGR, NAV vs 52-week and since-purchase chart, look-through cap/sector mix | Import CAS, add lump sum, redemptions, switch-in/out |
| SIP | Active SIPs, next date, amount, step-up, missed instalments, SIP XIRR | Create SIP schedule; worker auto-generates expected instalments and matches them to CAS entries |
| Fund of funds | Same as MF, plus the underlying funds and their weights, so look-through goes two levels deep | Map FoF to underlying schemes (from the AMC disclosure) |
| Other | Bonds, FD, RD, PPF/EPF/NPS, gold, cash; accrued value today and at maturity | Enter principal, rate, compounding, start and maturity dates |
| Loans and EMI | Outstanding principal, EMIs paid/left, interest paid to date, amortisation chart, prepayment impact | Enter loan terms; mark prepayments and rate changes |
| Consolidated | Net worth (assets minus loans), asset-class mix, overall P/L and XIRR, look-through equity cap/sector mix across stocks + ETFs + MF + FoF, monthly net-worth trend | Own profile for members; admin can filter by profile or whole household |
| What-if | Your actual cash flows replayed into an alternative and compared on value and XIRR | See Calculations below |
| Discord alerts | Daily summary, SIP due, FD maturity, large moves, rebalance drift | Per-user webhook and a global webhook, each toggleable |

**Discord design:** a `notification_channel` row holds the webhook URL (encrypted), scope `global` or `user`, and an `enabled` flag. A user can only manage their own channels; only the admin manages global ones and decides whether a user may add channels at all. Each alert type is a separate subscription row, so a user can keep "SIP due" on and "daily summary" off.

## Calculations

XIRR is the headline return for anything with multiple cash flows (SIPs, top-ups, partial redemptions); CAGR is shown only for single lump-sum holdings and for NAV-to-NAV fund comparison, because CAGR on a SIP overstates or understates the real return.

**XIRR** — solve for r, with cash flows Cᵢ on dates dᵢ (investments negative, current value as the final positive flow on today's date):

```latex
\sum_{i} \frac{C_i}{(1 + r)^{(d_i - d_0)/365}} = 0
```

Implement Brent's method in TypeScript (bracket −99% to +1000%), falling back to Newton's method; return `null` (not 0) when it does not converge or the holding is under 30 days old. Check it against Excel's XIRR on a dozen real folios before trusting it.

**CAGR** — for a fund's NAV between two dates, or a lump sum held over t years:

```latex
\text{CAGR} = \left(\frac{V_{end}}{V_{start}}\right)^{1/t} - 1
```

**Fund comparison table:** for each fund held, show 1y/3y/5y CAGR from NAV history beside your own XIRR in it. The gap between the two tells you whether your timing helped or hurt.

**Look-through allocation:** for each fund, exposure to stock s is your fund value × the stock's weight in the latest disclosure. Sum across all funds, equity ETFs, FoF underlying funds and direct equity (gold, silver and debt ETFs go to their own asset classes, not equity), then group by the AMFI cap class and the NSE sector. Show the disclosure month next to the chart so it is clear the fund side is up to \~6 weeks old.

**P/L:** unrealised = current value − cost of units held (FIFO for MF, matching how capital gains are taxed in India); realised = sale value − FIFO cost of units sold. Dividends and interest are tracked separately as income.

**What-if engine:** take the real dated cash flows of the chosen holdings and replay them into an alternative — another fund, a Nifty 50/Nifty Next 50 index fund, an FD at a given rate, or gold. Output: alternative value today, alternative XIRR, and the difference. Lump sum vs SIP and "what if I had stopped this SIP in year X" use the same replay.

## Auth, profiles and feature flags

Separate **users** (who logs in) from **profiles** (whose money it is): one login can see several profiles, which is how a household works — you may manage your parents' MF folios without them ever logging in.

- **Roles:** `admin` and `member`. No public signup; the admin creates users and sends an invite link.
- **Profiles:** each holding belongs to a profile (identified by PAN, stored hashed, last 4 shown). A `profile_access` row grants a user `view` or `manage` on a profile. Members see only their own profile, never a Household total. Only the admin can hold access to several profiles and the Household view that sums them.
- **Feature flags, two levels:** a global flag (admin turns a module on for the deployment) and a per-user grant (admin allows that user to use it). A module is visible only when both are on. Flags: `equity`, `mf`, `sip`, `fof`, `other`, `loans`, `what_if`, `discord_user`, `ai_agents`.
- **Tokens:** one signed 7-day session cookie that slides while in use, checked against the session row on every request, so sign-out, a password change or disabling a user applies at once (built this way instead of 15-min access + refresh tokens, which raced under parallel requests); argon2 password hashing; optional TOTP for the admin later.
- **Defence in depth on the Pi:** keep Cloudflare Access in front, as with Finance Tracker. On Vercel, enable Vercel's deployment protection or rely on app login alone with rate limiting on `/auth`.
- **Audit log:** every flag change, access grant and import is recorded with user and timestamp.

## Data model

Transactions are the source of truth; holdings, P/L and XIRR are derived and cached in snapshot tables that the worker rebuilds nightly or after an import.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `app_user` | Logins | email, password\_hash, role, totp\_secret |
| `profile` | Whose money | name, pan\_hash, pan\_last4 |
| `profile_access` | Who sees which profile | user\_id, profile\_id, level (view/manage) |
| `feature_flag` / `user_feature` | Global and per-user switches | key, enabled / user\_id, key, enabled |
| `instrument` | Stocks, MF schemes, FoFs, bonds | type, isin, nse\_symbol, amfi\_code, name, sector, cap\_class, is\_fof, underlying\_class, tracked\_index |
| `price_history` | EOD price or NAV | instrument\_id, date, close (PK: instrument\_id + date) |
| `fund_holding` | Monthly disclosure | fund\_id, as\_of\_month, holding\_instrument\_id, weight\_pct |
| `account` | Demat, folio, bank, lender | profile\_id, kind, provider, ref\_last4 |
| `txn` | Every buy/sell/SIP/dividend/switch | account\_id, instrument\_id, date, type, units, price, amount, fees, source (cas/manual/csv) |
| `sip_plan` | SIP schedule | account\_id, instrument\_id, amount, day, step\_up\_pct, start, end |
| `fixed_asset` | FD/RD/bond/PPF/EPF/NPS/gold | profile\_id, kind, principal, rate, compounding, start, maturity |
| `loan` / `loan_event` | Loans, prepayments, rate changes | principal, rate, tenure\_months, emi, start / date, kind, amount |
| `holding_snapshot` | Derived holding per day | profile\_id, instrument\_id, date, units, cost, value, xirr |
| `notification_channel` / `alert_subscription` | Discord | scope, owner\_user\_id, webhook\_enc, enabled / channel\_id, alert\_type, enabled |
| `agent_report` | Agent output (Pi only) | instrument\_id, agent, verdict, summary, created\_at |
| `audit_log` | Admin and import trail | user\_id, action, detail\_json, at |
| target\_allocation | Target mix and drift band per profile | profile\_id, asset\_class, target\_pct, band\_pct |

Use `NUMERIC(20,6)` for units and NAV and `NUMERIC(18,2)` for rupee amounts — never floats. `instrument` and `price_history` are shared across profiles; everything else is scoped by profile.

## AI agents (Pi only)

Package the equity-research agents you already planned as a separate `agents` container, started only with `docker compose --profile ai up`; the Vercel build never includes it.

| Agent | Input | Output into Wealth Portfolio |
| --- | --- | --- |
| 1. News | Your held and watch-listed large/mid-cap stocks | Daily headline digest per stock |
| 2. Fundamentals | Quarterly results, balance sheet | Score and key ratios per stock |
| 3. Buy/Sell/Hold | Outputs of 1 and 2 | Verdict + reasoning, stored in `agent_report` and shown on the stock page |
| 4. IPO | Upcoming mainboard IPOs | Shortlist worth applying for |
| 5. Portfolio review (new) | Your consolidated holdings, look-through mix, what-if results | Weekly note: concentration, overlap between funds, drift from target allocation |

How it connects:

- The agents stay in Python in their own container, so the Next.js choice does not affect them.
- They read holdings through a read-only Postgres role (`wp_agent_ro`) and write only to `agent_report`; they have no access to Discord secrets or user passwords.
- The Next.js app shows agent output only when the global `ai_agents` flag and the user's grant are both on.
- Execution stays manual: agents suggest, you decide. No broker order endpoints anywhere in this app.
- **Cost guard:** your Anthropic workspace spend limit is set to $0, so the agents will fail until you raise it or point them at a local model. Set a monthly cap and a per-run token budget in `.env` before enabling the profile.

## Reusing NSE-Signal without touching it

Port the useful logic into Wealth Portfolio as TypeScript modules; do not import from NSE-Signal's repo, share its database, or call its containers.

| Take from NSE-Signal | Where it lands | Change needed |
| --- | --- | --- |
| Incremental yfinance EOD ingestion | `lib/ingest/prices.ts` | Ported to TypeScript on yahoo-finance2; universe = holdings + watchlist, not Nifty 50 only |
| Dhan quote client | `lib/providers/dhan.ts` | Read-only REST calls; credentials from this app's env |
| Discord webhook sender | `lib/notify/discord.ts` | Add per-user/global channel routing and toggles |
| APScheduler job pattern | `worker` container (node-cron) | Same job functions also called by Vercel Cron |
| Strategy registry and `Strategy.positions(df)` | Optional signals tab on the stock page | SMA crossover and RSI ported to TS; keep the single-source-of-truth invariant |
| Backtester metrics (CAGR, drawdown, Sharpe) | `lib/analytics/metrics.ts` | Reused by the what-if engine |
| Pytest no-lookahead and idempotency tests | `tests/` (Vitest) | Rewritten for the ported code, with sample fixtures copied once from NSE-Signal's repo |

NSE-Signal keeps its own database, schedule and Discord channel. If both apps fetch the same prices, that is a few extra requests a day — an acceptable cost for keeping them independent.

## Suggested additions and changes

The biggest win is making CAS import the main way data gets in; manual entry for hundreds of SIP instalments will kill the app's usefulness within a month.

**Changes to the requirement as written**

- **SIP is not an asset class.** Treat it as a schedule on an MF holding, not a separate portfolio; the SIP page becomes a view over MF transactions.
- **Fund of funds = MF with a flag.** Keep its own tab, but store it as an MF scheme with `is_fof = true` so NAV, XIRR and CAS import work unchanged; only look-through differs.
- **Split "Other" into Fixed income (FD, RD, bonds, PPF, EPF, NPS debt) and Alternatives (gold, SGB, REITs, cash).** They behave differently in allocation and tax.
- **Vercel needs a deliberate data decision.** Full PANs, folios and balances on a public host are a bigger risk than on your Pi behind Cloudflare Access. Decided: Vercel runs as a sample-data demo for now; it may become a secondary deployment later, and only then needs a Mumbai-region Postgres.

**Additions worth building**

1. **Target allocation + drift alerts** — set e.g. 60/25/15 equity/debt/gold; Discord alert when any class drifts more than 5 points. In the build (phase 6); targets are set per profile, with a default band the admin can change.
2. **Fund overlap matrix** — % of common stocks between every pair of your funds, straight from the look-through data.
3. **Direct vs regular plan check** — flag regular-plan holdings and estimate the expense-ratio drag over 10 years.
4. **Benchmark per fund** — compare each fund's CAGR with its category index, not just with your other funds.
5. **Capital gains report by financial year** — short/long-term split per FIFO lot, exportable for your CA; plus a "harvest gains this year" helper.
6. **Goals** — tag holdings to goals (house, education, retirement) and show progress and required SIP.
7. **Nominee and maturity register** — which folio/FD has a nominee, and what matures in the next 90 days.
8. **Nightly `pg_dump` of `wealth_portfolio`** to the same backup target as Finance Tracker, and CSV/PDF export of every view.
9. **Finance Tracker link (later)** — pull monthly savings from Finance Tracker to show how much of your surplus actually got invested.

## Phased delivery

Build MF first: it has the most data (CAS + free NAV history) and answers most of your stated questions; equity and the rest reuse the same ledger.

1. **Foundation** — repo, Compose + Vercel configs, auth, profiles, feature flags, instrument master from AMFI, sample-data seed for the Vercel demo, nightly backup.
2. **Mutual funds + SIP** — CAS import, NAV sync, holdings, P/L, XIRR, CAGR comparison, NAV history chart.
3. **Equity** and ETFs — demat CAS, tradebook (XLS/CSV) and contract-note (PDF) import, ported NSE-Signal price ingestion and Dhan quotes, sector and cap split.
4. **Look-through** — AMFI cap list, disclosure parser framework with generic CSV upload (AMC-specific parsers added as needed), FoF two-level look-through, consolidated cap/sector chart, overlap matrix.
5. **Fixed income, alternatives, loans/EMI** — accrual and amortisation, consolidated net worth.
6. **What-if + Discord** — replay engine, target allocation and drift alerts, per-user/global channels, alert subscriptions.
7. **AI agents (Pi)** — `agents` container, read-only role, `agent_report` UI, cost caps.

## Open questions

- [x] Is the Vercel build for real household data, or a demo with sample data?
- [ ] Which AMCs do you hold today? None held yet; add them here once you invest, and each one gets its parser then.
- [ ] Which brokers besides Dhan hold your equity? Both PDF and XLS imports are planned, so this only sets which broker layouts get mapped first (for tradebook import formats)?
- [x] Should a family member with their own login see the Household total, or only their own profile?
- [ ] Your starting target split (equity/debt/gold %) to seed drift alerts, now an in-build addition.
