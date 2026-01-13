-- budgie schema (SQLite)
-- Notes:
-- - Amounts are stored as integer cents.
-- - Balances are computed as: opening_balance + sum(inflows) - sum(outflows).
-- - Scheduled items store recurrence rules (freq/interval) anchored at start_date.

PRAGMA foreign_keys = ON;

-- ----
-- Accounts
-- ----
CREATE TABLE IF NOT EXISTS account (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT    NOT NULL UNIQUE,
  opening_date         TEXT    NOT NULL, -- ISO-8601 date: YYYY-MM-DD
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  description          TEXT,
  archived_at          TEXT, -- NULL = active; otherwise ISO date/time

  CHECK (opening_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE INDEX IF NOT EXISTS idx_account_archived_at ON account(archived_at);

-- ----
-- Manual entries (actuals / adjustments)
-- ----
-- An entry represents a money movement.
-- - income:  dest_account_id NOT NULL, src_account_id NULL
-- - expense: src_account_id NOT NULL, dest_account_id NULL
-- - transfer: both NOT NULL
-- - adjustment: either side may be used; treat as real movement you want in balances
CREATE TABLE IF NOT EXISTS entry (
  id               INTEGER PRIMARY KEY,
  entry_date       TEXT    NOT NULL, -- ISO-8601 date
  name             TEXT    NOT NULL,
  amount_cents     INTEGER NOT NULL,
  src_account_id   INTEGER,
  dest_account_id  INTEGER,
  description      TEXT,

  -- Optional link to the schedule that this entry corresponds to (useful for reconciliation).
  schedule_id      INTEGER,

  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (src_account_id)  REFERENCES account(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (dest_account_id) REFERENCES account(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (schedule_id)     REFERENCES schedule(id) ON UPDATE CASCADE ON DELETE SET NULL,

  CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (amount_cents > 0),
  CHECK (src_account_id IS NULL OR dest_account_id IS NULL OR src_account_id != dest_account_id),
  CHECK (
    (src_account_id IS NOT NULL) OR (dest_account_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_entry_date ON entry(entry_date);
CREATE INDEX IF NOT EXISTS idx_entry_src ON entry(src_account_id);
CREATE INDEX IF NOT EXISTS idx_entry_dest ON entry(dest_account_id);
CREATE INDEX IF NOT EXISTS idx_entry_schedule ON entry(schedule_id);

-- ----
-- Scheduled items (projection)
-- ----
-- This replaces your separate Scheduled Income/Expense/Transfer tables.
-- A schedule is anchored at start_date (the first occurrence).
-- Supported recurrence patterns in pure SQL expansion:
-- - D / W (interval N)
-- - M on a specific day-of-month (bymonthday), interval N
-- - Y (interval N)
--
-- Weekly patterns are anchored at start_date's weekday (or optionally forced via byweekday).
-- (SQLite weekday: 0=Sunday..6=Saturday)
CREATE TABLE IF NOT EXISTS schedule (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL, -- 'I' (income) | 'E' (expense) | 'T' (transfer)
  amount_cents    INTEGER NOT NULL,
  src_account_id  INTEGER,
  dest_account_id INTEGER,

  start_date      TEXT    NOT NULL, -- first occurrence date
  end_date        TEXT,             -- optional final date (inclusive)

  freq            TEXT    NOT NULL, -- 'D' (daily) | 'W' (weekly) | 'M' (monthly) | 'Y' (yearly)
  interval        INTEGER NOT NULL DEFAULT 1, -- every N units

  -- For MONTHLY schedules: day of month (1..31). If NULL, day(start_date) is used.
  bymonthday      INTEGER,

  -- For WEEKLY schedules: force weekday (0..6). If NULL, weekday(start_date) is used.
  byweekday       INTEGER,

  description     TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (src_account_id)  REFERENCES account(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (dest_account_id) REFERENCES account(id) ON UPDATE CASCADE ON DELETE RESTRICT,

  CHECK (kind IN ('I','E','T')),
  CHECK (freq IN ('D','W','M','Y')),
  CHECK (interval >= 1),
  CHECK (amount_cents > 0),
  CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (bymonthday IS NULL OR (bymonthday BETWEEN 1 AND 31)),
  CHECK (byweekday IS NULL OR (byweekday BETWEEN 0 AND 6)),
  CHECK (
    CASE kind
      WHEN 'I' THEN (dest_account_id IS NOT NULL AND src_account_id IS NULL)
      WHEN 'E' THEN (src_account_id IS NOT NULL AND dest_account_id IS NULL)
      WHEN 'T' THEN (src_account_id IS NOT NULL AND dest_account_id IS NOT NULL AND src_account_id != dest_account_id)
    END
  )
);

CREATE INDEX IF NOT EXISTS idx_schedule_active ON schedule(is_active);
CREATE INDEX IF NOT EXISTS idx_schedule_start ON schedule(start_date);
CREATE INDEX IF NOT EXISTS idx_schedule_end ON schedule(end_date);
CREATE INDEX IF NOT EXISTS idx_schedule_src ON schedule(src_account_id);
CREATE INDEX IF NOT EXISTS idx_schedule_dest ON schedule(dest_account_id);

-- ----
-- Schedule revisions (amount changes over time)
-- ----
-- A revision overrides schedule.amount_cents for occurrences on/after effective_date.
-- You can add multiple revisions; the most recent effective_date <= occurrence date wins.
CREATE TABLE IF NOT EXISTS schedule_revision (
  id            INTEGER PRIMARY KEY,
  schedule_id   INTEGER NOT NULL,
  effective_date TEXT   NOT NULL, -- ISO-8601 date
  amount_cents  INTEGER NOT NULL,
  description   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (schedule_id) REFERENCES schedule(id) ON UPDATE CASCADE ON DELETE CASCADE,

  CHECK (effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (amount_cents > 0),
  UNIQUE (schedule_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_revision_schedule_date
  ON schedule_revision(schedule_id, effective_date);

-- ----
-- Helpful views
-- ----

-- Per-entry deltas (+/-) per account.
CREATE VIEW IF NOT EXISTS v_entry_delta AS
SELECT
  e.id            AS entry_id,
  e.entry_date    AS entry_date,
  e.name          AS name,
  e.description   AS description,
  e.schedule_id   AS schedule_id,
  e.src_account_id  AS account_id,
  -e.amount_cents AS delta_cents
FROM entry e
WHERE e.src_account_id IS NOT NULL

UNION ALL

SELECT
  e.id            AS entry_id,
  e.entry_date    AS entry_date,
  e.name          AS name,
  e.description   AS description,
  e.schedule_id   AS schedule_id,
  e.dest_account_id AS account_id,
  e.amount_cents  AS delta_cents
FROM entry e
WHERE e.dest_account_id IS NOT NULL;

-- Current balance considering ONLY manual entries.
-- (Projection uses query templates in queries.sql because SQLite views can't be parameterized.)
CREATE VIEW IF NOT EXISTS v_account_balance_actual AS
SELECT
  a.id,
  a.name,
  a.opening_date,
  a.opening_balance_cents,
  a.description,
  a.archived_at,
  a.opening_balance_cents + COALESCE(SUM(d.delta_cents), 0) AS balance_cents
FROM account a
LEFT JOIN v_entry_delta d
  ON d.account_id = a.id
 AND d.entry_date >= a.opening_date
GROUP BY a.id;
