package budgie

import (
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func mustReadRepoFile(t *testing.T, relFromRepoRoot string) []byte {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}

	// This test file lives at <repo>/internal/budgie/server_test.go.
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	b, err := os.ReadFile(filepath.Join(repoRoot, relFromRepoRoot))
	if err != nil {
		t.Fatalf("read %s: %v", relFromRepoRoot, err)
	}
	return b
}

func TestProjectedBalancesAsOf_ScanMatchesQuery(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		t.Fatalf("pragma foreign_keys: %v", err)
	}

	schema := mustReadRepoFile(t, "schema.sql")
	if _, err := db.Exec(string(schema)); err != nil {
		t.Fatalf("apply schema: %v", err)
	}

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
