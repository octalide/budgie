package budgie

import (
	"context"
	"database/sql"
	"testing"
)

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

	if err := runMigrations(db); err != nil {
		t.Fatalf("run migrations: %v", err)
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
