# Wealth Portfolio

Household portfolio tracker for Indian investors: mutual funds, SIPs, fund of funds, stocks, ETFs, deposits, PPF/EPF/NPS, gold and loans, with FIFO cost basis, XIRR, fund look-through, net worth, what-if comparisons and Discord alerts. One Next.js codebase deploys two ways:

| | Raspberry Pi 5 (Docker Compose) | Vercel |
|---|---|---|
| Data | Your real portfolio | Fictional sample household only |
| Database | Existing `shared-postgres`, database `wealth_portfolio` | Neon / Supabase (Mumbai) |
| Scheduled jobs | `worker` container (node-cron, IST) | Vercel Cron → `/api/cron/sample-extend` |
| Statement imports | On (Python `cas-parser` container) | Off |
| Live quotes | Dhan (read-only, optional) | Off |
| Discord alerts | On (worker, daily 08:00 IST) | Off |
| AI agents | Phase 7, Compose profile `ai` | Never |

This release covers **phases 1–6** of the design plan: foundation, mutual funds + SIPs, equity + ETFs, look-through, fixed income/alternatives/loans, and what-if + target allocation + Discord.

## What's in it

- **Auth & access**: argon2id passwords; a signed 7-day session cookie that slides while you use it, checked against the session row on every request (so sign-out, password change or disabling a user takes effect immediately); login rate limit (5 / 15 min / IP); temp passwords must be changed before anything else; audit log.
- **Users vs profiles**: members see only their own profile; admins see every profile and a Household total. Profiles can be view-only for a user.
- **Feature flags**: every module is on/off globally and granted per member (Admin → Features). Unbuilt phases show as locked.
- **Mutual funds**: holdings, NAV, your XIRR beside the fund's own 1Y/3Y return, SEBI category and asset-class split, Regular-plan warning, closed positions.
- **SIPs**: schedule with yearly step-up; expected instalments matched to ledger purchases (±7 days, ±5%) so missed/bounced SIPs show up; next-due on the Overview.
- **Fund of funds**: recognised from AMFI category; look-through arrives in phase 4.
- **Stocks**: sector and market-cap split (AMFI half-yearly list), day change, splits/bonuses/dividends.
- **ETFs**: grouped by what they hold (gold/debt ETFs don't count as equity), price vs latest NAV, 1-year tracking difference vs the index.
- **Holding page**: price/NAV chart with your buys/sells and average cost, 1/3/5Y returns, 52-week range, FIFO open lots, realised gains with short/long term.
- **Imports (preview → confirm, file never stored)**: CAMS/KFintech detailed CAS, NSDL/CDSL demat CAS (adds only the gap vs your ledger), broker tradebook XLS/XLSX/CSV (header-alias matching, F&O skipped), contract-note PDF (charges spread across trades). Re-importing is safe; tradebook and contract note for the same trade dedupe on trade id. Each import can be undone.
  - **Any spreadsheet**: transactions from another platform's export (Groww, Kuvera, Coin…) or your own records. Columns are matched by header and can be re-mapped in the preview; a downloadable template shows the format. Needs a date, a name/symbol/ISIN/AMFI code and two of units, price, amount.
  - **Deposits & savings** and **Loans** from CSV/XLSX templates (FD/RD/bonds/PPF/EPF/NPS/gold/cash/property; loans with prepayment and rate-change rows). Names already in the profile are left unchanged, new events for an existing loan are added, and Undo removes exactly what the import added.
  - **Preview**: untick rows you don't want; match an unrecognised fund or stock to one you already have, so its history lands in one place.
  - **SIP detection**: after an import (and on the SIPs page), monthly purchase runs without a plan are offered as SIPs (amount, day, yearly step-up, running or stopped), checked against the same matcher the SIP page uses.
  - **Stocks known only by ISIN** (demat CAS, fund disclosures) take their NSE symbol from the first tradebook that names them, and the weekly NSE equity list job fills in the rest, merging any duplicate it finds.
- **Manual entry** for anything the imports miss.
- **Jobs**: AMFI scheme master + daily NAV, mfapi.in NAV history (gap-only after first sync), Yahoo EOD prices, Dhan live quotes, Dhan security-id mapping, NSE equity list. All idempotent; runnable from Admin → Jobs.
- **Nightly `pg_dump`** with 14-day retention.

### Phase 4: look-through
- **Fund disclosures** (Admin → Disclosures): upload an AMC's monthly portfolio xlsx (the fund's sheet is found by name) or a plain CSV (`name, isin, weight`, optional `sector`, `type`). Lines are classified from the ISIN (INE…01 equity, INF fund units, IN0–4 G-secs, other INE debt), weights in percent or fractions, totals/sub-totals skipped. Parsers are a registry (`src/lib/lookthrough/disclosure.ts`), so an AMC-specific one can go in front of the generic parser. Re-uploading a month replaces it.
- **Look-through page**: direct stocks + stocks inside funds and ETFs by AMFI cap class and sector, asset classes after look-through, the largest companies you own (direct vs through which funds), and a **fund overlap matrix** (Σ min(wₐ, w_b) over common stocks).
- **Fund of funds** resolve two (or more) levels deep: a FoF line pointing at another scheme uses that scheme's own disclosure. The FoF page lists each FoF's underlying funds.
- **AMFI cap list** upload now also adds listed companies you hold only through funds, so they get a cap class too.

### Phase 5: fixed income, alternatives, loans, net worth
- **Fixed income & alternatives**: FD (cumulative or payout), RD, bonds, PPF, EPF, NPS, SGB, gold, REITs, cash, property. Value is accrued from rate/compounding/dates, or grown from a statement balance you update. Maturity register (last 30 / next 90 days); close or reopen on maturity.
- **Loans & EMIs**: reducing-balance amortisation, prepayments and rate changes (lender adjusts tenure or EMI), outstanding/EMIs left/interest paid, interest and months saved by prepaying, balance chart vs the schedule without prepayments, year-by-year table.
- **Overview is the consolidated view**: net worth = market holdings + fixed assets − loans, asset-class mix across everything, a month-end net worth trend (units held then × month-end price, accrued fixed assets, amortised loans), and what's coming up (SIPs, maturities, EMIs).

### Phase 6: what-if, target allocation, Discord
- **What-if**: replays your real dated cash flows (one holding, a product, or everything) into an index, another fund/ETF/stock, an FD at a rate, or the same holdings as a lump sum on day one / stopped after a date. Value, XIRR and worst price fall side by side, plus value over time. On the Pi, an alternative without stored history is fetched on demand.
- **Target allocation**: per-profile targets (must total 100%) with a band per class (admin default ±5 points). Drift, and the rupees to add or trim, show on the page and the Overview. A home is left out unless you give real estate a target.
- **Discord**: personal channels (members need the "Personal Discord alerts" grant) and household channels (admin). Subscriptions per channel: daily summary, SIP due (2 days ahead), maturities (7 days), large moves (admin threshold, default 5%), drift (weekly reminder). Webhook URLs are validated as discord.com webhooks and stored AES-256-GCM encrypted (`ALERTS_KEY`, falling back to `JWT_SECRET`); each alert is recorded so re-running the job never repeats it. Off on the Vercel demo.

On upgrade, `migrate` switches each newly built module on once; members still need it ticked under Admin → Features.

### Taken from NSE-Signal (cloned and ported, the running app is untouched)

| NSE-Signal | Here |
|---|---|
| `app/ingest.py` full-window re-fetch + upsert (adjusted closes rebase) | `src/lib/jobs/index.ts` → `prices` |
| `app/data_provider.py` "Yahoo only behind one interface" | `src/lib/providers/yahoo.ts` |
| `app/dhan_client.py` 24 h token tracking, 1.1 s throttle, 401 = Data API not active, quoted client id | `src/lib/providers/dhan.ts` |
| `app/instrument_master.py` compact scrip master filter | `parseScripMaster` + `dhan-scrip-master` job |
| `app/backtest.py` CAGR, max drawdown, Sharpe (252 days) | `src/lib/calc/returns.ts` |
| Login rate limit 5 / 15 min, first-boot admin from env | `src/lib/auth/session.ts`, `scripts/migrate.ts` |

## Deploy on the Raspberry Pi

1. Create the database on `shared-postgres` (edit the password first):
   ```sh
   docker exec -i shared-postgres psql -U postgres < deploy/init-db.sql
   ```
2. `cp .env.example .env` and fill it in (`openssl rand -hex 32` for each secret). Set `SHARED_NETWORK` to the Docker network `shared-postgres` and Caddy are on (`docker network ls`).
3. Add `deploy/Caddyfile.snippet` to your site block and reload Caddy.
4. Build and start:
   ```sh
   docker compose up -d --build
   docker compose logs -f app worker
   ```
   The app runs migrations on start and creates the first admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. On first boot the worker loads AMFI's scheme list and NSE's equity list.
5. Open `https://home.tinyserverlab.in/wealth`, sign in, change the temporary password, then **Import**.
6. Optional: Admin → Data sources → paste a Dhan access token (24 h) and upload AMFI's market-cap xlsx.

Restore a backup: `pg_restore -d "$DATABASE_URL" --clean --if-exists backups/<file>.dump`

## Deploy the Vercel demo

1. Create a Postgres (Supabase or Neon, Mumbai region) and a Vercel project from this repo.
2. Environment variables:
   - `DEPLOY_TARGET=vercel`, `JWT_SECRET`, `CRON_SECRET`, `SAMPLE_PASSWORD`, and `SHOW_SAMPLE_PASSWORD=1` if the login page should show it.
   - **Supabase:** don't use the direct `db.<ref>.supabase.co` string. It is IPv6-only and Vercel can't reach it (`ENETUNREACH 2406:…`). In Supabase → **Connect**, copy:
     - **Transaction pooler** (port 6543) → `DATABASE_URL` (used by the app at runtime)
     - **Session pooler** (port 5432) → `MIGRATION_DATABASE_URL` (used by migrations and the sample seed during the build)

     Both look like `postgresql://postgres.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:<port>/postgres`; note the user is `postgres.<project-ref>`.
   - **Neon:** the pooled string for `DATABASE_URL`, the direct one for `MIGRATION_DATABASE_URL`.
3. Deploy. `npm run vercel-build` migrates, loads the sample household and builds. Vercel Cron rolls the sample prices forward daily.

Sign in as `admin@sample.local` (admin) or `meera@sample.local` (member). All funds, stocks and prices are fictional ("Demo …").

## Local development

```sh
npm install
export DATABASE_URL=postgres://postgres@localhost:5432/wealth_portfolio JWT_SECRET=$(openssl rand -hex 32) SECURE_COOKIES=false
npm run db:migrate          # + ADMIN_EMAIL / ADMIN_PASSWORD for a first admin
npm run db:seed-sample      # optional fictional household
npm run dev
npm test                    # 80 unit tests: XIRR, FIFO, SIP matching, AMFI, CAS, tradebook, contract note,
                            # disclosures + look-through + overlap, FD/RD/PPF accrual, loan amortisation, what-if, drift, webhooks,
                            # spreadsheet/deposit/loan imports, SIP detection
npm run job -- scheme-master
```
PDF parser: `cd parser && pip install -r requirements.txt && uvicorn app:app --port 8001`, then `PARSER_URL=http://127.0.0.1:8001`.

## Layout

```
src/app/(app)/        pages: overview, mf, sip, fof, equity, etf, fixed, loans, lookthrough, allocation, what-if, alerts, holding/[id], transactions, import, admin/*
src/app/api/          auth refresh/logout, cron/[job], instruments search, health
src/lib/calc/         xirr, fifo, returns, sip, dates, fixed, loan, whatif, drift   (pure, unit-tested)
src/lib/lookthrough/  disclosure parsers, look-through engine + overlap, disclosure import
src/lib/notify/       Discord sender (encrypted webhooks) and the alerts job
src/lib/providers/    amfi + mfapi, yahoo, dhan
src/lib/import/       cas, tradebook, contractNote, spreadsheet, records (deposits/loans), columns, commit, commitRecords, parserClient
src/lib/jobs/         every scheduled job, one registry
src/lib/portfolio/    holdings, sips (ledger -> positions), consolidated (net worth + trend), lookthrough, whatif, allocation
src/lib/db/schema.ts  Drizzle schema; migrations in drizzle/
parser/               FastAPI + casparser + pdfplumber (internal network only)
worker/               node-cron scheduler for the Pi
deploy/               backup script, Caddy snippet, database init
```

## Notes and limits

- **AMFI changed NAVAll.txt** to 8 columns (Plan and Option split out) in 2026. The parser reads column positions from the header, so both layouts work.
- **Contract notes** are parsed by table headers, not per-broker templates. Always check the preview; if a layout isn't recognised, import the tradebook instead.
- **Tradebooks don't include charges**, so cost basis from a tradebook excludes brokerage and taxes.
- **ETF "vs NAV"** uses AMFI's end-of-day NAV, not live iNAV (no free source). **Tracking difference** compares with the price index, so dividends flatter ETFs slightly.
- **Demat CAS** lists holdings, not trades: it fills gaps at a cost you confirm in the preview.
- XIRR shows "—" for holdings under 30 days old.
- **Look-through runs on the latest disclosure per fund**, so the fund side is up to ~6 weeks old (shown on the page). Sectors come from the stock's own record (Yahoo or your overrides), falling back to the AMC's industry name, so the two taxonomies can mix.
- **Fixed-asset values are accrued**, compounding fractional periods; banks compute broken periods as simple interest, so expect differences of a few rupees. Loan positions assume every EMI was paid on schedule.
- **Net worth trend** is computed on each page load from the ledger, month-end prices and asset/loan terms. There's no snapshot table to go stale; it is fast enough for a household (about 0.1 s on the sample data).
- **What-if** ignores tax, exit loads and charges, and stocks/ETFs replay on adjusted prices.
- Not financial advice. Execution stays manual; there are no order endpoints.
