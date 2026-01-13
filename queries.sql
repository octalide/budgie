-- Query recipes for budgie (SQLite)
-- These are templates; bind parameters in your sqlite3 client.
--
-- Schedule codes:
--   kind: I (income), E (expense), T (transfer)
--   freq: D (daily), W (weekly), M (monthly), Y (yearly)
--
-- Amount revisions:
--   If schedule_revision rows exist, the effective amount for an occurrence date is:
--   the revision with the greatest effective_date <= occ_date; otherwise schedule.amount_cents.

-- sqlite3 CLI tip:
--   When using `.parameter set`, bind ISO dates like:
--     .parameter set :as_of "'2026-01-13'"
--   (The extra quotes ensure the value is TEXT, not arithmetic.)

-- --------------------
-- 1) Balance as-of date (actual manual entries only)
-- --------------------
-- :as_of is an ISO date YYYY-MM-DD.
--
-- For each account, includes opening balance + deltas from manual entries
-- on/after opening_date and on/before :as_of.
WITH deltas AS (
  SELECT account_id, SUM(delta_cents) AS delta_cents
  FROM v_entry_delta
  WHERE entry_date <= :as_of
  GROUP BY account_id
)
SELECT
  a.name,
  a.opening_date,
  a.opening_balance_cents,
  COALESCE(d.delta_cents, 0) AS delta_cents,
  a.opening_balance_cents + COALESCE(d.delta_cents, 0) AS balance_cents
FROM account a
LEFT JOIN deltas d ON d.account_id = a.id
WHERE a.archived_at IS NULL
ORDER BY a.name;

-- --------------------
-- 2) Expand schedules into occurrences for a date window
-- --------------------
-- Parameters:
-- :from_date  inclusive window start (YYYY-MM-DD)
-- :to_date    inclusive window end   (YYYY-MM-DD)
--
-- Supported patterns here:
-- - D: start_date + interval days
-- - W: start_date + interval*7 days (optionally aligned to byweekday)
-- - M: day-of-month = COALESCE(bymonthday, day(start_date)), step interval months
-- - Y: start_date + interval years
--
-- Notes:
-- - For MONTHLY schedules on 29/30/31, we clamp to last day of month.
-- - For WEEKLY schedules, if byweekday is set, we shift the anchor forward
--   to the first occurrence on/after start_date with that weekday, then step.
WITH RECURSIVE
schedule_anchor AS (
  SELECT
    s.*,
    -- normalize start anchor for WEEKLY with byweekday override
    CASE
      WHEN s.freq != 'W' OR s.byweekday IS NULL THEN s.start_date
      ELSE date(
        s.start_date,
        printf(
          '+%d days',
          ( (s.byweekday - CAST(strftime('%w', s.start_date) AS INTEGER) + 7) % 7 )
        )
      )
    END AS anchor_date,

    COALESCE(s.bymonthday, CAST(strftime('%d', s.start_date) AS INTEGER)) AS dom
  FROM schedule s
  WHERE s.is_active = 1
),
recur AS (
  -- seed: one row per schedule at its first occurrence (anchor)
  SELECT
    id AS schedule_id,
    name,
    kind,
    amount_cents,
    src_account_id,
    dest_account_id,
    description,
    freq,
    interval,
    start_date,
    end_date,
    anchor_date AS occ_date,
    dom
  FROM schedule_anchor

  UNION ALL

  -- step: compute next occurrence date based on freq
  SELECT
    r.schedule_id,
    r.name,
    r.kind,
    r.amount_cents,
    r.src_account_id,
    r.dest_account_id,
    r.description,
    r.freq,
    r.interval,
    r.start_date,
    r.end_date,
    CASE r.freq
      WHEN 'D' THEN date(r.occ_date, printf('+%d days', r.interval))
      WHEN 'W' THEN date(r.occ_date, printf('+%d days', 7 * r.interval))
      WHEN 'M' THEN
        date(
          date(r.occ_date, printf('+%d months', r.interval), 'start of month'),
          printf(
            '+%d days',
            (
              CASE
                WHEN r.dom > CAST(
                  strftime(
                    '%d',
                    date(
                      date(r.occ_date, printf('+%d months', r.interval), 'start of month'),
                      '+1 month',
                      '-1 day'
                    )
                  )
                  AS INTEGER
                )
                THEN CAST(
                  strftime(
                    '%d',
                    date(
                      date(r.occ_date, printf('+%d months', r.interval), 'start of month'),
                      '+1 month',
                      '-1 day'
                    )
                  )
                  AS INTEGER
                )
                ELSE r.dom
              END
            ) - 1
          )
        )
      WHEN 'Y' THEN date(r.occ_date, printf('+%d years', r.interval))
    END AS occ_date,
    r.dom
  FROM recur r
  WHERE r.occ_date < :to_date
)
SELECT
  schedule_id,
  occ_date,
  kind,
  name,
  COALESCE(
    (
      SELECT sr.amount_cents
      FROM schedule_revision sr
      WHERE sr.schedule_id = recur.schedule_id
        AND sr.effective_date <= recur.occ_date
      ORDER BY sr.effective_date DESC
      LIMIT 1
    ),
    amount_cents
  ) AS amount_cents,
  src_account_id,
  dest_account_id,
  description
FROM recur
WHERE occ_date BETWEEN :from_date AND :to_date
  AND (end_date IS NULL OR occ_date <= end_date)
ORDER BY occ_date, name;

-- --------------------
-- 3) Projected balance as-of date (opening + manual entries + scheduled occurrences)
-- --------------------
-- Parameters:
-- :as_of      (YYYY-MM-DD)
-- :from_date  typically MIN(opening_date) or a chosen projection start
--
-- This treats schedules as if they always occur. If you later add "skip/override"
-- support, you can subtract those here.
WITH
occ AS (
  -- Reuse the schedule expansion over [:from_date, :as_of]
  -- (Inlining the expansion to keep SQLite happy without parameters in views.)
  WITH RECURSIVE
  schedule_anchor AS (
    SELECT
      s.*,
      CASE
        WHEN s.freq != 'W' OR s.byweekday IS NULL THEN s.start_date
        ELSE date(
          s.start_date,
          printf(
            '+%d days',
            ( (s.byweekday - CAST(strftime('%w', s.start_date) AS INTEGER) + 7) % 7 )
          )
        )
      END AS anchor_date,
      COALESCE(s.bymonthday, CAST(strftime('%d', s.start_date) AS INTEGER)) AS dom
    FROM schedule s
    WHERE s.is_active = 1
  ),
  recur AS (
    SELECT
      id AS schedule_id,
      kind,
      name,
      amount_cents,
      src_account_id,
      dest_account_id,
      description,
      freq,
      interval,
      start_date,
      end_date,
      anchor_date AS occ_date,
      dom
    FROM schedule_anchor

    UNION ALL

    SELECT
      r.schedule_id,
      r.kind,
      r.name,
      r.amount_cents,
      r.src_account_id,
      r.dest_account_id,
      r.description,
      r.freq,
      r.interval,
      r.start_date,
      r.end_date,
      CASE r.freq
        WHEN 'D' THEN date(r.occ_date, printf('+%d days', r.interval))
        WHEN 'W' THEN date(r.occ_date, printf('+%d days', 7 * r.interval))
        WHEN 'M' THEN
          date(
            date(r.occ_date, printf('+%d months', r.interval), 'start of month'),
            printf(
              '+%d days',
              (
                CASE
                  WHEN r.dom > CAST(
                    strftime(
                      '%d',
                      date(
                        date(r.occ_date, printf('+%d months', r.interval), 'start of month'),
                        '+1 month',
                        '-1 day'
                      )
                    )
                    AS INTEGER
                  )
                  THEN CAST(
                    strftime(
                      '%d',
                      date(
                        date(r.occ_date, printf('+%d months', r.interval), 'start of month'),
                        '+1 month',
                        '-1 day'
                      )
                    )
                    AS INTEGER
                  )
                  ELSE r.dom
                END
              ) - 1
            )
          )
        WHEN 'Y' THEN date(r.occ_date, printf('+%d years', r.interval))
      END AS occ_date,
      r.dom
    FROM recur r
    WHERE r.occ_date < :as_of
  )
  SELECT
    schedule_id,
    occ_date,
    kind,
    name,
    COALESCE(
      (
        SELECT sr.amount_cents
        FROM schedule_revision sr
        WHERE sr.schedule_id = recur.schedule_id
          AND sr.effective_date <= recur.occ_date
        ORDER BY sr.effective_date DESC
        LIMIT 1
      ),
      amount_cents
    ) AS amount_cents,
    src_account_id,
    dest_account_id
  FROM recur
  WHERE occ_date BETWEEN :from_date AND :as_of
    AND (end_date IS NULL OR occ_date <= end_date)
),
projected_deltas AS (
  SELECT src_account_id AS account_id, -amount_cents AS delta_cents
  FROM occ
  WHERE src_account_id IS NOT NULL

  UNION ALL

  SELECT dest_account_id AS account_id, amount_cents AS delta_cents
  FROM occ
  WHERE dest_account_id IS NOT NULL
),
all_deltas AS (
  SELECT account_id, SUM(delta_cents) AS delta_cents
  FROM (
    SELECT account_id, delta_cents FROM v_entry_delta WHERE entry_date <= :as_of
    UNION ALL
    SELECT account_id, delta_cents FROM projected_deltas
  )
  GROUP BY account_id
)
SELECT
  a.name,
  a.opening_date,
  a.opening_balance_cents,
  COALESCE(d.delta_cents, 0) AS delta_cents,
  a.opening_balance_cents + COALESCE(d.delta_cents, 0) AS projected_balance_cents
FROM account a
LEFT JOIN all_deltas d ON d.account_id = a.id
WHERE a.archived_at IS NULL
ORDER BY a.name;
