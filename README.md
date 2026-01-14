# budgie

Budgie is a small personal finance tracker I built for myself. It’s a lightweight Go + SQLite app with a simple web UI for keeping tabs on accounts, entries, and projections.

## Features

- Accounts, manual entries, schedules, and projections
- Single Go binary with a local web UI
- SQLite storage (one file)

## Requirements

- Go 1.22+
- A C toolchain for `github.com/mattn/go-sqlite3` (e.g., `gcc`)

## Quick start

1. (Optional) copy the sample env file:
   - `cp .env.example .env`
2. Run the server:
   - `go run .`
3. Open the UI:
   - http://127.0.0.1:4000/

Budgie auto-creates the database schema on first run.

## Configuration

Settings are read from environment variables. See `.env.example` for the full list. Common ones:

- `BUDGIE_DB` — database path (default `./budgie.db`)
- `BUDGIE_BIND` — bind address (default `127.0.0.1:4000`)
- `PORT` — alternate port override
- `BUDGIE_ALLOW_SIGNUP` — allow local account signups
- `BUDGIE_OIDC_*` — optional OIDC login (Google, etc.)

If you expose Budgie to the internet, put it behind HTTPS and turn on the proxy/cookie settings from `.env.example`.

## Support

This is a personal project. It’s provided as‑is with no guaranteed support.
