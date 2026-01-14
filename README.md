# budgie

A tiny SQLite database for budget tracking and balance projection.

This schema is intentionally "just a DB" at the core, with a small local web UI for editing data.

## What changed vs your spreadsheet tables

Instead of separate tables for scheduled income/expense/transfer and unscheduled income/expense/transfer, this uses:

- `account`: your accounts + an opening balance and opening date.
- `entry`: manual ("actual") money movements that **must** include a date (this covers your unscheduled transfers/expenses and any other real transactions you want to record).
- `schedule`: recurring items that **do not** store a date per occurrence—only a `start_date` anchor and recurrence parameters (`freq`, `interval`, etc.). These are used for **projection**.

This keeps the model consistent while still matching your workflow.

## Initialize the database

From this folder:

- Create `budgie.db` and apply schema:
  - `sqlite3 budgie.db < schema.sql`

- (Optional) sanity check:
  - `sqlite3 budgie.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"`

## Web UI (minimal)

There’s a tiny local web UI (Go + vanilla JS) served by `main.go`.

(If you see `app.py`/`requirements.txt` in this repo: that was an earlier Flask prototype and can be ignored/removed.)

### Run it

- Start the server:
  - `go run .`

Notes:

- This uses `github.com/mattn/go-sqlite3`, so you need a working C toolchain (e.g. `gcc`) available.

Then open:

- http://127.0.0.1:5177/

### Use an existing database file

By default the server uses `./budgie.db`.

To point it at a different DB path:

- `BUDGIE_DB=/path/to/budgie.db go run .`

To bind a different port:

- `PORT=8080 go run .`

## Public hosting & security

Budgie now supports authenticated sessions (local passwords + OIDC) so you can expose it publicly behind TLS.

### TLS (encrypt FE/BE traffic)

Run Budgie behind a reverse proxy (Caddy, Nginx, Traefik). For a single-host deployment, Caddy is the easiest way to get automatic HTTPS. Ensure the app only binds locally and the proxy handles TLS termination.

When you terminate TLS at a proxy, set:

- `BUDGIE_TRUST_PROXY=true` (use forwarded headers for scheme/host)
- `BUDGIE_COOKIE_SECURE=true` (secure cookies)

If you want Budgie to bind publicly without a proxy, set `BUDGIE_BIND=0.0.0.0:5177` and terminate TLS elsewhere (or use a VPN). Not recommended on its own.

### Auth (local + OIDC + passkeys)

Budgie supports:

- Local accounts with salted PBKDF2-SHA256 hashes
- OIDC sign-in (Google, Auth0, Keycloak, etc.)
- Linking an OIDC identity to a local account

Most OIDC providers now support passkeys/WebAuthn. If you enable passkeys in the provider, users can sign in using their hardware passkeys through the OIDC flow.

Configure OIDC via environment variables:

- `BUDGIE_OIDC_ISSUER`
- `BUDGIE_OIDC_CLIENT_ID`
- `BUDGIE_OIDC_CLIENT_SECRET`
- `BUDGIE_OIDC_REDIRECT_URL` (must match the provider callback)
- `BUDGIE_OIDC_PROVIDER_NAME` (optional label shown in the UI)

Local signups are controlled via `BUDGIE_ALLOW_SIGNUP=false`. The first user can still register if no users exist (useful for bootstrapping).

### Database encryption (at rest)

Budgie can use SQLCipher if you provide `BUDGIE_DB_KEY`. This requires a SQLCipher-enabled SQLite build.

For `github.com/mattn/go-sqlite3`, this typically means compiling with SQLCipher support and CGO enabled.

If you don’t want SQLCipher, use full-disk encryption (LUKS) or store the DB on an encrypted volume.

## Data entry basics

### Accounts

Accounts store an opening balance at a specific opening date. Amounts are integer cents.

Example:

- Checking with $573.24 on 2026-01-13:

  `INSERT INTO account (name, opening_date, opening_balance_cents, description)
   VALUES ('CheckingJ', '2026-01-13', 57324, 'Joint checking');`

### Manual entries (unscheduled expenses/transfers)

Rules:

- Expense: `src_account_id` set, `dest_account_id` NULL
- Income: `dest_account_id` set, `src_account_id` NULL
- Transfer: both set

Example unscheduled expense (bought one Monster on 2026-01-13 from CheckingE):

1. Find account id:
   `SELECT id, name FROM account WHERE name='CheckingE';`

2. Insert entry:

   `INSERT INTO entry (entry_date, name, amount_cents, src_account_id, description)
    VALUES ('2026-01-13', 'Monster', 300, (SELECT id FROM account WHERE name='CheckingE'), 'Bought one monster');`

Example unscheduled transfer (move $200 from CheckingJ to SavingsJ):

`INSERT INTO entry (entry_date, name, amount_cents, src_account_id, dest_account_id, description)
 VALUES (
   '2026-01-13',
   'Move to savings',
   20000,
   (SELECT id FROM account WHERE name='CheckingJ'),
   (SELECT id FROM account WHERE name='SavingsJ'),
   'Manual transfer'
 );`

### Scheduled items (projection only)

Schedules have one anchor date (`start_date`) and a recurrence pattern.

Supported for pure-SQL expansion right now:

Schedule codes:

- `kind`: `I` (income), `E` (expense), `T` (transfer)
- `freq`: `D` (daily), `W` (weekly), `M` (monthly), `Y` (yearly)

Supported recurrence patterns in the current SQL queries:

- `D` every N days
- `W` every N weeks
- `M` every N months on a specific day-of-month (`bymonthday`)
- `Y` every N years (anchored by `start_date`)

Examples:

Biweekly paycheck every 2 weeks starting 2026-01-09:

`INSERT INTO schedule (name, kind, amount_cents, dest_account_id, start_date, freq, interval, description)
 VALUES (
  'SMX', 'I', 255200,
  (SELECT id FROM account WHERE name='CheckingE'),
  '2026-01-09', 'W', 2,
  'Ethan paycheck'
 );`

Monthly rent on the 1st starting 2026-01-01:

`INSERT INTO schedule (name, kind, amount_cents, src_account_id, start_date, freq, interval, bymonthday, description)
 VALUES (
  'Housing', 'E', 185000,
  (SELECT id FROM account WHERE name='CheckingJ'),
  '2026-01-01', 'M', 1, 1,
  'Rent'
 );`

Every 3 months trash service starting 2026-03-15:

`INSERT INTO schedule (name, kind, amount_cents, src_account_id, start_date, freq, interval, bymonthday, description)
 VALUES (
  'Trash', 'E', 10644,
  (SELECT id FROM account WHERE name='CheckingJ'),
  '2026-03-15', 'M', 3, 15,
  'Trash service'
 );`

### Revisions (changing scheduled amounts over time)

If a recurring amount changes starting on a date (Netflix goes up, power bill changes, etc.), add a row to `schedule_revision`.

Example: Netflix increases to $15.00 effective 2026-03-01:

`INSERT INTO schedule_revision (schedule_id, effective_date, amount_cents, description)
 VALUES (
   (SELECT id FROM schedule WHERE name='Netflix'),
   '2026-03-01',
   1500,
   'Price increase'
 );`

Projection queries automatically use the most recent revision whose `effective_date` is <= the occurrence date.

## Balances and projections

See `queries.sql` for copy/paste query templates.

### About sqlite3 parameters and dates

The `sqlite3` CLI tokenizes `.parameter set` values in a way that treats `2026-01-01` as arithmetic (`2026 - 1 - 1`).

So if you want to use the parameterized queries in `queries.sql`, set ISO dates like this:

- `.parameter set :from_date "'2026-01-01'"`
- `.parameter set :to_date   "'2026-02-15'"`
- `.parameter set :as_of     "'2026-02-15'"`

(Yes, the nested quotes are a little cursed. Welcome to computers.)

Common ones:

- Actual balances as-of a date (opening + manual entries)
- Schedule occurrence expansion for a window
- Projected balances as-of a date (opening + manual entries + schedule occurrences)

## Notes / next upgrades

- If you want to record real transactions for scheduled items *without double-counting*, the next step is adding a "schedule occurrence reconciliation" table (mark an occurrence as posted/skipped/overridden). The schema already allows linking an `entry` back to a `schedule` via `entry.schedule_id`.
- If you want more complex rules (e.g., "monthly on the 3rd Friday"), we can extend `schedule` to store an RFC5545 RRULE string and compute occurrences in a small helper CLI later.
