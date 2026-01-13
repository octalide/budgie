package budgie

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func envDBPath() string {
	if p := strings.TrimSpace(os.Getenv("BUDGIE_DB")); p != "" {
		return p
	}
	return "budgie.db"
}

// DBPath returns the DB path that will be used by OpenDB.
func DBPath() string {
	return envDBPath()
}

func ensureSchema(db *sql.DB) error {
	var name string
	err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='account'").Scan(&name)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		// Some drivers return ErrNoRows, some return scan error; handle by checking table existence differently.
		// We'll just proceed to try to load schema if scan failed.
	}

	schemaBytes, err := os.ReadFile("schema.sql")
	if err != nil {
		return err
	}
	_, err = db.Exec(string(schemaBytes))
	return err
}

// OpenDB opens (and initializes if needed) the SQLite DB.
func OpenDB() (*sql.DB, error) {
	path := envDBPath()
	// Ensure directory exists if user points at a path
	if dir := filepath.Dir(path); dir != "." {
		_ = os.MkdirAll(dir, 0o755)
	}

	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := ensureSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}
