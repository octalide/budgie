package budgie

import (
	"database/sql"
	"net/http"
)

// RegisterAPI registers all /api/* HTTP routes onto the provided mux.
func RegisterAPI(mux *http.ServeMux, db *sql.DB) {
	srv := &server{db: db}

	mux.HandleFunc("/api/meta", srv.meta)
	mux.HandleFunc("/api/accounts", srv.accounts)
	mux.HandleFunc("/api/accounts/", srv.accountByID)
	mux.HandleFunc("/api/schedules", srv.schedules)
	mux.HandleFunc("/api/schedules/", srv.scheduleByID)
	mux.HandleFunc("/api/revisions", srv.revisions)
	mux.HandleFunc("/api/revisions/", srv.revisionByID)
	mux.HandleFunc("/api/entries", srv.entries)
	mux.HandleFunc("/api/entries/", srv.entryByID)
	mux.HandleFunc("/api/occurrences", srv.occurrences)
	mux.HandleFunc("/api/balances", srv.balances)
	mux.HandleFunc("/api/balances/series", srv.balancesSeries)
}
