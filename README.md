# Personal Stock Portfolio

Copyright (c) 2026 Anh Quang Nguyen. All rights reserved.

A stock portfolio tracker built with a security-first architecture — the
kind of auth, encryption, and audit-logging practices you'd expect in a
real fintech product — combined with live market data, a watchlist, and
a place to keep your own research notes on every stock you follow.

## Features

**Dashboard** — a quick overview: portfolio cost basis, holding count,
watchlist count, note count, plus a live table of every stock you're
following with current price and daily % change.

**Portfolio** — track your actual holdings (ticker, shares, cost basis).
Share counts and cost basis are encrypted at rest with AES-256-GCM.
Export your holdings to a real `.xlsx` file anytime, and a copy on disk
auto-updates every time you add, edit, or delete a holding.

**Stock page** — ticker, company name, live price and daily change,
a historical price chart (7D/30D/90D/180D/1Y), and basic company
information (industry, exchange, market cap, IPO date), all pulled live
from Finnhub.

**Investment notes** — for any stock: why you're interested, what you
like, the risks, your thesis, and personal notes, with a last-updated
timestamp. One note per ticker, editable anytime.

**Watchlist** — add or remove tickers you want to follow, see live price
and daily change for each, click through to that stock's full page.

**Security** — bcrypt password hashing, JWT access + rotating refresh
tokens, optional TOTP 2FA, forgot/change password flows, rate limiting,
security headers, and a full audit log of account activity. See
[SECURITY.md](./SECURITY.md) for the complete threat model.

## Architecture

**The frontend is a classic multi-page site, not a single-page app.**
Every page — `dashboard.html`, `portfolio.html`, `stock.html`, and so on
— is a complete, standalone file. Each page's full JavaScript logic is
written directly inside that page's own `<script>` block: there is no
shared `api.js`, no shared component library, and no page imports code
from another page. **The only file every page references externally is
`style.css`.** This is a deliberate choice, not an oversight — the
tradeoff is some repeated code across pages (token handling, the fetch
helper, the nav bar) in exchange for every page being fully readable and
debuggable on its own, with nothing "hidden" in an imported module.

The backend uses a small set of well-vetted, industry-standard
open-source libraries (Express, bcrypt, jsonwebtoken, speakeasy, pg,
exceljs) for things that shouldn't be hand-rolled — password hashing,
JWT signing, TOTP codes, the PostgreSQL driver, and `.xlsx` generation.
Live market data comes from Finnhub, proxied through the backend so your
API key never reaches the browser.

Fonts come from the operating system's own installed fonts — nothing is
downloaded from Google Fonts or any CDN. There's also a zero-dependency
static file server included (`serve.js`), built only from Node's own
`http` module, so the frontend needs nothing installed to run beyond a
browser and Node itself.

## Stack

- **Backend:** Node.js, Express, PostgreSQL (via `pg`), JWT, bcrypt,
  speakeasy (TOTP), exceljs (Excel export), Finnhub (live market data)
- **Frontend:** Vanilla HTML/CSS/JavaScript, one file per page, no
  framework, no bundler, no shared JS files
- **Database:** PostgreSQL — schema auto-created on first boot

## Getting started

### 1. PostgreSQL

If you don't already have PostgreSQL running locally, pick one:

**Option A — install it locally:** [postgresql.org/download](https://www.postgresql.org/download/)

**Option B — use a free hosted database:** [Neon](https://neon.tech) or
[Supabase](https://supabase.com) give you a connection string in about a
minute, no local install needed.

Then create a database (skip if using a hosted provider):

```bash
createdb personal_stock_portfolio
```

### 2. Get a Finnhub API key

Live prices, company info, and historical charts all come from
[Finnhub](https://finnhub.io). Sign up for a free account and copy your
API key — the free tier covers everything this app uses (quotes, company
profiles, historical candles) at 60 requests/minute, which is comfortably
enough given the backend caches responses for 30 seconds to 1 hour
depending on the endpoint.

### 3. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- Your PostgreSQL connection (`DATABASE_URL`, or the individual `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` fields)
- Your Finnhub key in `STOCK_API_KEY`
- Generate the three secret keys:

```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 32   # FIELD_ENCRYPTION_KEY
```

(On Windows PowerShell without openssl:
`-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })`)

Then run it:

```bash
npm run dev
```

You should see "Connected to PostgreSQL and verified schema." followed
by "Personal Stock Portfolio API listening on http://localhost:4000".

### 4. Frontend

No install step. Two ways to run it:

**Option A — just open the file:** double-click `frontend/index.html`.

**Option B — serve it locally (recommended):**

```bash
cd frontend
node serve.js
```

Then open `http://localhost:5500`. Register an account, then explore:
add a holding on the **Portfolio** page, follow a stock on **Watchlist**,
click a ticker to see its live price and chart on the **Stock** page, and
write yourself a note on the **Notes** page.

### 5. Viewing your data directly

Holdings are encrypted at rest, so a normal SQL tool will show scrambled
text for `shares_enc`/`cost_basis_enc`. To see your real, decrypted data:

```bash
cd backend
node view-data.js
```

Or use the **Export to Excel** button on the Portfolio page.

## Project structure

```
personal-stock-portfolio/
├── LICENSE
├── SECURITY.md
├── backend/
│   ├── exports/                 # auto-synced per-user .xlsx files (gitignored)
│   ├── view-data.js             # CLI tool to decrypt and print your data
│   └── src/
│       ├── db/init.js           # PostgreSQL schema
│       ├── middleware/          # auth guard, rate limiting, error handling
│       ├── routes/
│       │   ├── auth.js          # register, login, 2FA, password reset/change
│       │   ├── holdings.js      # portfolio CRUD + Excel export
│       │   ├── watchlist.js     # followed stocks
│       │   ├── notes.js         # investment notes, one per ticker
│       │   ├── stocks.js        # Finnhub proxy (quote/profile/candles)
│       │   └── audit.js
│       ├── utils/                # encryption, TOTP, audit log, Excel export
│       └── server.js
└── frontend/
    ├── style.css                # the one file every page shares
    ├── serve.js                  # zero-dependency dev server
    ├── index.html                # redirects to login or dashboard
    ├── login.html
    ├── register.html
    ├── forgot-password.html
    ├── reset-password.html
    ├── change-password.html
    ├── security-2fa.html
    ├── dashboard.html            # overview + followed-stocks table
    ├── portfolio.html            # holdings CRUD, Excel export, audit log
    ├── watchlist.html            # add/remove followed stocks
    ├── stock.html                # live price, chart, company info
    └── notes.html                # investment notes, all or per-ticker
```

Each `.html` file above is complete and self-contained — open any one of
them and you'll find every line of its logic right there.

## Roadmap ideas

- [ ] Real transactional email for password resets (Resend/SendGrid/Postmark)
- [ ] Live market value + gain/loss on the Portfolio page (now that live
      quotes are available via the Finnhub proxy)
- [ ] CSV import of existing brokerage statements
- [ ] Email alerts on new-device login
- [ ] WebAuthn/passkey support as an alternative to TOTP
- [ ] Docker Compose for a one-command local Postgres + backend setup
- [ ] Automated tests for the auth flows (Vitest + supertest)

## License

See [LICENSE](./LICENSE). Copyright (c) 2026 Anh Quang Nguyen. All rights
reserved.
