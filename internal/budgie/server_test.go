package budgie

import (
	"testing"
)

func TestProjectedBalancesAsOf_ScanMatchesQuery(t *testing.T) {
	db := newTestDB(t)

	// Minimal data: one account, no entries, no schedules.
	res, err := db.Exec(`
		INSERT INTO account (name, opening_date, opening_balance_cents)
		VALUES (?, ?, ?)
	`, "Test Checking", "2026-01-01", int64(12345))
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	if _, err := res.LastInsertId(); err != nil {
		t.Fatalf("insert account id: %v", err)
	}

	srv := &server{db: db}
	pts, err := srv.projectedBalancesAsOf("2026-01-01", "2026-01-10")
	if err != nil {
		t.Fatalf("projectedBalancesAsOf: %v", err)
	}
	if len(pts) != 1 {
		t.Fatalf("expected 1 account point, got %d", len(pts))
	}
	if pts[0].BalanceCents != 12345 {
		t.Fatalf("expected projected balance %d, got %d", int64(12345), pts[0].BalanceCents)
	}
}
