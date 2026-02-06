package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/octalide/budgie/internal/budgie"
)

func main() {
	db, err := budgie.OpenDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open db: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	authCfg, err := budgie.LoadAuthConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load auth config: %v\n", err)
		os.Exit(1)
	}
	authSvc, err := budgie.NewAuthService(context.Background(), db, authCfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize auth: %v\n", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()

	// UI
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join("static", "index.html"))
	})

	// API
	budgie.RegisterAPI(mux, db, authSvc)

	addr := "127.0.0.1:4000"
	if bind := strings.TrimSpace(os.Getenv("BUDGIE_BIND")); bind != "" {
		addr = bind
	} else if p := strings.TrimSpace(os.Getenv("PORT")); p != "" {
		addr = "127.0.0.1:" + p
	}

	handler := budgie.WithRequestLogging(budgie.WithSecurityHeaders(mux, authSvc), authCfg.TrustProxy)

	// Periodic cleanup of expired sessions.
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			budgie.CleanupExpiredSessions(db)
		}
	}()

	fmt.Printf("budgie listening on http://%s (db=%s)\n", addr, budgie.DBPath())
	if err := http.ListenAndServe(addr, handler); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
