# Romarick's Vintage

Premium Wholesale Drinks & Wine Management System — a production-ready business management platform for a single-owner wholesale drinks and wine business.

## Stack

- **Backend:** Node.js + Express, session auth (PostgreSQL-backed sessions, bcrypt)
- **Frontend:** React 18 + Vite + Tailwind CSS 4 + Recharts
- **Database:** PostgreSQL (portable instance at `C:\xampp\pgsql`, port `5433`; or any Postgres via `DATABASE_URL`)
- **Reports:** PDF (pdfkit) + Excel (exceljs) exports

## Quick start (Windows)

1. `Create-Desktop-Shortcut.bat` — once, to get the desktop icon.
2. `Start-RomaricksVintage.bat` — starts PostgreSQL, installs deps/builds on first run, runs migrations, opens http://127.0.0.1:4000.
3. Sign in: **admin@romaricks.local / admin123** — change this immediately in Settings.

## Manual setup

```bash
npm run install:all      # install server + client deps
npm run migrate          # apply SQL migrations (server/src/migrations)
npm run seed             # admin user, categories, sample products, settings
npm run build            # build client → client/dist (served by the API)
npm start                # API + app on :4000
npm run dev              # dev mode: API :4000 + Vite :5173 (proxy)
```

### Database

Config in `server/.env`:

```
DATABASE_URL=postgres://romarick:romarick@127.0.0.1:5433/romaricks_vintage
SESSION_SECRET=<long random string>
PG_BIN=C:\xampp\pgsql\bin        # for pg_dump backups
```

**Portable PostgreSQL** (bundled): data at `C:\xampp\pgsql\data`. Manual control:
`C:\xampp\pgsql\bin\pg_ctl -D C:\xampp\pgsql\data start|stop|status`

**Cloud deployment:** point `DATABASE_URL` at any managed Postgres (Neon, Supabase, RDS…), run `npm run migrate && npm run seed`, deploy `server/` with `NODE_ENV=production` and `COOKIE_SECURE=1` behind HTTPS, and serve `client/dist` statically.

## Features

- **Dashboard** — revenue, gross/net profit, expenses, debts, stock value, daily chart, top products, low-stock alerts; all computed live from the DB with date filters.
- **Products** — two types: *Wholesale Drinks* (configurable bottles-per-pallet, default 12; bought/sold in pallets or bottles) and *Wines* (bottles). Images, brands, categories, min-stock.
- **Sales** — pallet/bottle pricing with overridable prices, discounts, cash/bank/MoMo/other, full & partial payment, credit sales tied to customers, printable receipts, stock checked and decremented atomically.
- **Purchases** — pallet/bottle receiving, weighted-average cost, supplier credit, safe void (reverses stock only if no payments allocated).
- **Customers/Suppliers** — profiles, history, balances, FIFO debt repayment allocation.
- **Expenses** — categories, dates, amounts.
- **Reports** — sales, profitability, purchases, expenses, debts, net profit; date filters; PDF & Excel export.
- **Settings** — business info/logo/receipt text, currency (XAF), default pallet size, password, `pg_dump` backups, audit log.

## Money & stock rules

- Money is stored as integer FCFA (no floats).
- Stock is always counted in **bottles**; pallets are display/transaction units converted via each product's `bottles_per_pallet` (snapshot on every line item).
- Sales/purchases/payments run inside DB transactions with row locks — a failed operation changes nothing.
- Profit = revenue − COGS (weighted-average cost snapshot per sale line) − expenses.

## Tests

```bash
cd server && npm test    # node:test suite — needs the dev database running
```

## Restore a backup

```bash
C:\xampp\pgsql\bin\psql -h 127.0.0.1 -p 5433 -U romarick -d romaricks_vintage -f server\backups\<file>.sql
```

## Security notes

- No public registration; single seeded admin.
- Session cookie: httpOnly, SameSite=Lax; mutating requests require the `X-Requested-With` header (CSRF guard).
- Secrets live only in `server/.env` (never committed — it's in `.gitignore`).
