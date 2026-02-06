package budgie

import (
	"testing"
)

func TestActualBalancesAsOf(t *testing.T) {
	db := newTestDB(t)

	res, err := db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Checking", "2026-01-01", int64(10000),
	)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acct1, _ := res.LastInsertId()

	res, err = db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Savings", "2026-01-01", int64(5000),
	)
	if err != nil {
		t.Fatalf("insert account 2: %v", err)
	}
	acct2, _ := res.LastInsertId()

	if _, err := db.Exec(
		"INSERT INTO entry (entry_date, name, amount_cents, src_account_id) VALUES (?, ?, ?, ?)",
		"2026-01-05", "Groceries", int64(2500), acct1,
	); err != nil {
		t.Fatalf("insert entry: %v", err)
	}
	if _, err := db.Exec(
		"INSERT INTO entry (entry_date, name, amount_cents, dest_account_id) VALUES (?, ?, ?, ?)",
		"2026-01-06", "Refund", int64(1000), acct2,
	); err != nil {
		t.Fatalf("insert entry 2: %v", err)
	}
	if _, err := db.Exec(
		"INSERT INTO entry (entry_date, name, amount_cents, src_account_id, dest_account_id) VALUES (?, ?, ?, ?, ?)",
		"2026-01-07", "Transfer", int64(500), acct1, acct2,
	); err != nil {
		t.Fatalf("insert entry 3: %v", err)
	}

	srv := &server{db: db}
	pts, err := srv.actualBalancesAsOf("2026-01-10")
	if err != nil {
		t.Fatalf("actualBalancesAsOf: %v", err)
	}

	balances := make(map[int64]int64)
	for _, p := range pts {
		balances[p.ID] = p.BalanceCents
	}
	if balances[acct1] != 7000 {
		t.Fatalf("expected account 1 balance 7000, got %d", balances[acct1])
	}
	if balances[acct2] != 6500 {
		t.Fatalf("expected account 2 balance 6500, got %d", balances[acct2])
	}
}

func TestProjectedBalancesAsOf(t *testing.T) {
	db := newTestDB(t)

	res, err := db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Income", "2026-01-01", int64(10000),
	)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acctID, _ := res.LastInsertId()

	if _, err := db.Exec(
		`INSERT INTO schedule
		 (name, kind, amount_cents, dest_account_id, start_date, freq, interval, is_active)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"Paycheck", "I", int64(2000), acctID, "2026-01-01", "M", int64(1), int64(1),
	); err != nil {
		t.Fatalf("insert schedule: %v", err)
	}

	srv := &server{db: db}
	pts, err := srv.projectedBalancesAsOf("2026-01-01", "2026-02-01")
	if err != nil {
		t.Fatalf("projectedBalancesAsOf: %v", err)
	}
	if len(pts) != 1 {
		t.Fatalf("expected 1 account point, got %d", len(pts))
	}
	if pts[0].BalanceCents != 14000 {
		t.Fatalf("expected projected balance 14000, got %d", pts[0].BalanceCents)
	}
}

func TestYearlyScheduleLeapYearClamping(t *testing.T) {
	db := newTestDB(t)

	res, err := db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Checking", "2024-01-01", int64(100000),
	)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acctID, _ := res.LastInsertId()

	// Yearly schedule starting on Feb 29 (leap day 2024).
	if _, err := db.Exec(
		`INSERT INTO schedule
		 (name, kind, amount_cents, dest_account_id, start_date, freq, interval, is_active)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"AnnualBonus", "I", int64(5000), acctID, "2024-02-29", "Y", int64(1), int64(1),
	); err != nil {
		t.Fatalf("insert schedule: %v", err)
	}

	// Query occurrences from 2024-02-28 to 2027-03-01 to capture multiple years.
	q := occurrenceQuery()
	rows, err := db.Query(q, "2027-03-01", "2024-02-28", "2027-03-01")
	if err != nil {
		t.Fatalf("query occurrences: %v", err)
	}
	defer rows.Close()

	var dates []string
	for rows.Next() {
		var schedID int64
		var occDate, kind, name string
		var amountCents int64
		var srcID, destID *int64
		var desc *string
		if err := rows.Scan(&schedID, &occDate, &kind, &name, &amountCents, &srcID, &destID, &desc); err != nil {
			t.Fatalf("scan: %v", err)
		}
		dates = append(dates, occDate)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows err: %v", err)
	}

	expected := []string{"2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28"}
	if len(dates) != len(expected) {
		t.Fatalf("expected %d occurrences, got %d: %v", len(expected), len(dates), dates)
	}
	for i, exp := range expected {
		if dates[i] != exp {
			t.Errorf("occurrence %d: got %s, want %s", i, dates[i], exp)
		}
	}
}
