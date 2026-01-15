package budgie

import "testing"

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
