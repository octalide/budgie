package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/octalide/budgie/internal/budgie"
)

func main() {
	db, err := budgie.OpenDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open db: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

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
	budgie.RegisterAPI(mux, db)

	addr := "127.0.0.1:5177"
	if p := strings.TrimSpace(os.Getenv("PORT")); p != "" {
		addr = "127.0.0.1:" + p
	}

	fmt.Printf("budgie listening on http://%s (db=%s)\n", addr, budgie.DBPath())
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}
