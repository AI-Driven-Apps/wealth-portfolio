# Wealth Portfolio

Household portfolio tracker for Indian investors: mutual funds, SIPs, fund of funds, stocks and ETFs, with FIFO cost basis, XIRR, fund-vs-you returns and statement imports. One Next.js codebase deploys two ways:

| | Raspberry Pi 5 (Docker Compose) | Vercel |
|---|---|---|
| Data | Your real portfolio | Fictional sample household only |
| Database | Existing `shared-postgres`, database `wealth_portfolio` | Neon / Supabase (Mumbai) |
| Scheduled jobs | `worker` container (node-cron, IST) | Vercel Cron → `/api/cron/sample-extend` |
| Statement imports | On (Python `cas-parser` container) | Off |
| Live quotes | Dhan (read-only, optional) | Off |
| AI agents | Phase 7, Compose profile `ai` | Never |

This release covers **phases 1–3** of the design plan: foundation, mutual funds + SIPs, equity + ETFs.

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
- **Manual entry** for anything the imports miss.
- **Jobs**: AMFI scheme master + daily NAV, mfapi.in NAV history (gap-only after first sync), Yahoo EOD prices, Dhan live quotes, Dhan security-id mapping, NSE equity list. All idempotent; runnable from Admin → Jobs.
- **Nightly `pg_dump`** with 14-day retention.

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

1. Create a Postgres (Neon or Supabase, Mumbai region) and a Vercel project from this repo.
2. Environment variables: `DEPLOY_TARGET=vercel`, `DATABASE_URL`, `JWT_SECRET`, `CRON_SECRET`, `SAMPLE_PASSWORD`, and `SHOW_SAMPLE_PASSWORD=1` if the login page should show it.
3. Deploy. `npm run vercel-build` migrates, loads the sample household and builds. Vercel Cron rolls the sample prices forward daily.

Sign in as `admin@sample.local` (admin) or `meera@sample.local` (member). All funds, stocks and prices are fictional ("Demo …").

## Local development

```sh
npm install
export DATABASE_URL=postgres://postgres@localhost:5432/wealth_portfolio JWT_SECRET=$(openssl rand -hex 32) SECURE_COOKIES=false
npm run db:migrate          # + ADMIN_EMAIL / ADMIN_PASSWORD for a first admin
npm run db:seed-sample      # optional fictional household
npm run dev
npm test                    # 32 unit tests: XIRR, FIFO, SIP matching, AMFI, CAS, tradebook, contract note
npm run job -- scheme-master
```
PDF parser: `cd parser && pip install -r requirements.txt && uvicorn app:app --port 8001`, then `PARSER_URL=http://127.0.0.1:8001`.

## Layout

```
src/app/(app)/        pages: overview, mf, sip, fof, equity, etf, holding/[id], transactions, import, admin/*
src/app/api/          auth refresh/logout, cron/[job], instruments search, health
src/lib/calc/         xirr, fifo, returns, sip, dates   (pure, unit-tested)
src/lib/providers/    amfi + mfapi, yahoo, dhan
src/lib/import/       cas, tradebook, contractNote, commit, parserClient
src/lib/jobs/         every scheduled job, one registry
src/lib/portfolio/    holdings, sips (ledger -> positions)
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
- Not financial advice. Execution stays manual; there are no order endpoints.
