package budgie

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

type apiResponseAny struct {
	OK      bool   `json:"ok"`
	Data    any    `json:"data"`
	Error   string `json:"error"`
	Details any    `json:"details"`
}

func newTestAPIServer(t *testing.T, db *sql.DB) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()
	RegisterAPI(mux, db, nil)
	server := httptest.NewServer(WithSecurityHeaders(mux, nil))
	t.Cleanup(server.Close)
	return server
}

func decodeAPIResponse(t *testing.T, resp *http.Response) apiResponseAny {
	t.Helper()
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	var parsed apiResponseAny
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return parsed
}

func mustInt64(t *testing.T, v any) int64 {
	t.Helper()
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case json.Number:
		val, err := n.Int64()
		if err != nil {
			t.Fatalf("parse json number: %v", err)
		}
		return val
	default:
		t.Fatalf("unexpected number type %T", v)
	}
	return 0
}

func TestBalancesEndpointActual(t *testing.T) {
	db := newTestDB(t)

	res, err := db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Checking", "2026-01-01", int64(10000),
	)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acct1, _ := res.LastInsertId()

	res, err = db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Savings", "2026-01-01", int64(5000),
	)
	if err != nil {
		t.Fatalf("insert account 2: %v", err)
	}
	acct2, _ := res.LastInsertId()

	if _, err := db.Exec(
		"INSERT INTO entry (entry_date, name, amount_cents, src_account_id) VALUES (?, ?, ?, ?)",
		"2026-01-05", "Groceries", int64(2500), acct1,
	); err != nil {
		t.Fatalf("insert entry: %v", err)
	}
	if _, err := db.Exec(
		"INSERT INTO entry (entry_date, name, amount_cents, dest_account_id) VALUES (?, ?, ?, ?)",
		"2026-01-06", "Refund", int64(1000), acct2,
	); err != nil {
		t.Fatalf("insert entry 2: %v", err)
	}
	if _, err := db.Exec(
		"INSERT INTO entry (entry_date, name, amount_cents, src_account_id, dest_account_id) VALUES (?, ?, ?, ?, ?)",
		"2026-01-07", "Transfer", int64(500), acct1, acct2,
	); err != nil {
		t.Fatalf("insert entry 3: %v", err)
	}

	server := newTestAPIServer(t, db)
	resp, err := http.Get(server.URL + "/api/balances?mode=actual&as_of=2026-01-10")
	if err != nil {
		t.Fatalf("get balances: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	parsed := decodeAPIResponse(t, resp)
	if !parsed.OK {
		t.Fatalf("expected ok response, got %v", parsed.Error)
	}

	items, ok := parsed.Data.([]any)
	if !ok {
		t.Fatalf("expected list response, got %T", parsed.Data)
	}
	balances := make(map[int64]int64)
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("expected map row, got %T", item)
		}
		id := mustInt64(t, row["id"])
		bal := mustInt64(t, row["balance_cents"])
		balances[id] = bal
	}

	if balances[acct1] != 7000 {
		t.Fatalf("expected account 1 balance 7000, got %d", balances[acct1])
	}
	if balances[acct2] != 6500 {
		t.Fatalf("expected account 2 balance 6500, got %d", balances[acct2])
	}
}

func TestBalancesSeriesIncludesInterest(t *testing.T) {
	db := newTestDB(t)

	if _, err := db.Exec(
		`INSERT INTO account
		 (name, opening_date, opening_balance_cents, is_interest_bearing, interest_apr_bps, interest_compound)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		"Interest", "2026-01-01", int64(1000000), int64(1), int64(100000), "D",
	); err != nil {
		t.Fatalf("insert account: %v", err)
	}

	server := newTestAPIServer(t, db)
	resp, err := http.Get(server.URL + "/api/balances/series?mode=projected&from_date=2026-01-01&to_date=2026-01-15&step_days=7&include_interest=1")
	if err != nil {
		t.Fatalf("get balances series: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	parsed := decodeAPIResponse(t, resp)
	if !parsed.OK {
		t.Fatalf("expected ok response, got %v", parsed.Error)
	}

	data, ok := parsed.Data.(map[string]any)
	if !ok {
		t.Fatalf("expected object response, got %T", parsed.Data)
	}
	accounts, ok := data["accounts"].([]any)
	if !ok || len(accounts) != 1 {
		t.Fatalf("expected 1 account series, got %T with len %d", data["accounts"], len(accounts))
	}
	account, ok := accounts[0].(map[string]any)
	if !ok {
		t.Fatalf("expected account map, got %T", accounts[0])
	}
	balancesAny, ok := account["balance_cents"].([]any)
	if !ok {
		t.Fatalf("expected balance_cents list, got %T", account["balance_cents"])
	}
	if len(balancesAny) != 3 {
		t.Fatalf("expected 3 balance points, got %d", len(balancesAny))
	}

	b0 := mustInt64(t, balancesAny[0])
	b1 := mustInt64(t, balancesAny[1])
	b2 := mustInt64(t, balancesAny[2])
	if !(b1 > b0 && b2 > b1) {
		t.Fatalf("expected interest to increase balances, got %d -> %d -> %d", b0, b1, b2)
	}
}
