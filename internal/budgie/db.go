package budgie

import (
	"database/sql"
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
	if key := strings.TrimSpace(os.Getenv("BUDGIE_DB_KEY")); key != "" {
		if err := applyDBKey(db, key); err != nil {
			_ = db.Close()
			return nil, err
		}
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

func applyDBKey(db *sql.DB, key string) error {
	// SQLCipher expects PRAGMA key to be called before any other statements.
	// Note: This requires a SQLCipher-enabled SQLite build.
	escaped := strings.ReplaceAll(key, "'", "''")
	if _, err := db.Exec("PRAGMA key = '" + escaped + "'"); err != nil {
		return err
	}
	// Sanity check: force decryption attempt.
	var count int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master").Scan(&count); err != nil {
		return err
	}
	return nil
}
