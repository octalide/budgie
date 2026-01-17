package budgie

import (
	"database/sql"
	"net/http"
)

// RegisterAPI registers all /api/* HTTP routes onto the provided mux.
func RegisterAPI(mux *http.ServeMux, db *sql.DB, auth *AuthService) {
	srv := &server{db: db, auth: auth}

	mux.HandleFunc("/api/meta", srv.meta)
	mux.HandleFunc("/api/session", srv.session)
	mux.HandleFunc("/api/auth/login", srv.login)
	mux.HandleFunc("/api/auth/register", srv.register)
	mux.HandleFunc("/api/auth/logout", srv.logout)

	mux.HandleFunc("/auth/oidc/login", srv.oidcLogin)
	mux.HandleFunc("/auth/oidc/callback", srv.oidcCallback)

	requireAuth := srv.requireAuth

	mux.HandleFunc("/api/accounts", requireAuth(srv.accounts))
	mux.HandleFunc("/api/accounts/correct-balance", requireAuth(srv.accountCorrectBalance))
	mux.HandleFunc("/api/accounts/", requireAuth(srv.accountByID))
	mux.HandleFunc("/api/schedules", requireAuth(srv.schedules))
	mux.HandleFunc("/api/schedules/", requireAuth(srv.scheduleByID))
	mux.HandleFunc("/api/revisions", requireAuth(srv.revisions))
	mux.HandleFunc("/api/revisions/", requireAuth(srv.revisionByID))
	mux.HandleFunc("/api/entries", requireAuth(srv.entries))
	mux.HandleFunc("/api/entries/", requireAuth(srv.entryByID))
	mux.HandleFunc("/api/occurrences", requireAuth(srv.occurrences))
	mux.HandleFunc("/api/balances", requireAuth(srv.balances))
	mux.HandleFunc("/api/balances/series", requireAuth(srv.balancesSeries))
	mux.HandleFunc("/api/dashboard/layout", requireAuth(srv.dashboardLayout))
}
