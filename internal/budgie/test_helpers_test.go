package budgie

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func mustReadRepoFile(t *testing.T, relFromRepoRoot string) []byte {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("runtime.Caller failed")
	}

	// This test file lives at <repo>/internal/budgie/test_helpers_test.go.
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	b, err := os.ReadFile(filepath.Join(repoRoot, relFromRepoRoot))
	if err != nil {
		t.Fatalf("read %s: %v", relFromRepoRoot, err)
	}
	return b
}

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()

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

	return db
}

func newTestAuthService(t *testing.T, db *sql.DB, cfg AuthConfig) *AuthService {
	t.Helper()

	svc, err := NewAuthService(context.Background(), db, cfg)
	if err != nil {
		t.Fatalf("new auth service: %v", err)
	}
	return svc
}
