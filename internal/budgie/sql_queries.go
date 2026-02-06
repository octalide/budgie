package budgie

func occurrenceCTEDefs() string {
	return `
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
			WHEN 'Y' THEN
				date(
					printf('%04d-%02d-01',
						CAST(strftime('%Y', r.occ_date) AS INTEGER) + r.interval,
						CAST(strftime('%m', r.start_date) AS INTEGER)
					),
					printf(
						'+%d days',
						(
							CASE
								WHEN r.dom > CAST(
									strftime(
										'%d',
										date(
											printf('%04d-%02d-01',
												CAST(strftime('%Y', r.occ_date) AS INTEGER) + r.interval,
												CAST(strftime('%m', r.start_date) AS INTEGER)
											),
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
											printf('%04d-%02d-01',
												CAST(strftime('%Y', r.occ_date) AS INTEGER) + r.interval,
												CAST(strftime('%m', r.start_date) AS INTEGER)
											),
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
		END AS occ_date,
		r.dom
	FROM recur r
	WHERE r.occ_date < ?
)
`
}

func occurrenceQuery() string {
	return "\nWITH RECURSIVE\n" + occurrenceCTEDefs() + `
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
WHERE occ_date BETWEEN ? AND ?
	AND (end_date IS NULL OR occ_date <= end_date)
ORDER BY occ_date, name
`
}

func projectedBalanceQuery() string {
	return `
WITH RECURSIVE
` + occurrenceCTEDefs() + `,
occ AS (
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
	WHERE occ_date BETWEEN ? AND ?
		AND (end_date IS NULL OR occ_date <= end_date)
),
projected_deltas AS (
	SELECT src_account_id AS account_id, -amount_cents AS delta_cents
	FROM occ
	WHERE src_account_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM entry e
			WHERE e.schedule_id = occ.schedule_id
			AND e.entry_date = occ.occ_date
		)

	UNION ALL

	SELECT dest_account_id AS account_id, amount_cents AS delta_cents
	FROM occ
	WHERE dest_account_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM entry e
			WHERE e.schedule_id = occ.schedule_id
			AND e.entry_date = occ.occ_date
		)
),
all_deltas AS (
	SELECT account_id, SUM(delta_cents) AS delta_cents
	FROM (
		SELECT d.account_id, d.delta_cents
		FROM v_entry_delta d
		JOIN account a ON a.id = d.account_id
		WHERE d.entry_date <= ?
			AND d.entry_date >= a.opening_date

		UNION ALL

		SELECT account_id, delta_cents FROM projected_deltas
	)
	GROUP BY account_id
)
SELECT
	a.id,
	a.name,
	a.opening_date,
	a.opening_balance_cents,
	COALESCE(d.delta_cents, 0) AS delta_cents,
	a.opening_balance_cents + COALESCE(d.delta_cents, 0) AS projected_balance_cents,
	a.is_liability,
	a.is_interest_bearing,
	a.interest_apr_bps,
	a.interest_compound,
	a.exclude_from_dashboard
FROM account a
LEFT JOIN all_deltas d ON d.account_id = a.id
WHERE a.archived_at IS NULL
ORDER BY a.name
`
}
