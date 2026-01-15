package budgie

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

func mustMap(t *testing.T, v any) map[string]any {
	t.Helper()
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("expected map, got %T", v)
	}
	return m
}

func mustList(t *testing.T, v any) []any {
	t.Helper()
	lst, ok := v.([]any)
	if !ok {
		t.Fatalf("expected list, got %T", v)
	}
	return lst
}

func doJSON(t *testing.T, method, url string, payload any) *http.Response {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	req, err := http.NewRequest(method, url, bytes.NewBuffer(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	return resp
}

func TestAccountsEndpoints(t *testing.T) {
	db := newTestDB(t)
	server := newTestAPIServer(t, db)

	resp := doJSON(t, http.MethodPost, server.URL+"/api/accounts", map[string]any{
		"name":                  "Checking",
		"opening_date":          "2026-01-01",
		"opening_balance_cents": 10000,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	created := decodeAPIResponse(t, resp)
	if !created.OK {
		t.Fatalf("expected ok response, got %v", created.Error)
	}

	listResp, err := http.Get(server.URL + "/api/accounts")
	if err != nil {
		t.Fatalf("get accounts: %v", err)
	}
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.StatusCode)
	}
	list := decodeAPIResponse(t, listResp)
	rows := mustList(t, list.Data)
	if len(rows) != 1 {
		t.Fatalf("expected 1 account, got %d", len(rows))
	}
	row := mustMap(t, rows[0])
	if row["name"] != "Checking" {
		t.Fatalf("expected account name Checking, got %v", row["name"])
	}
}

func TestAccountsValidation(t *testing.T) {
	db := newTestDB(t)
	server := newTestAPIServer(t, db)

	resp := doJSON(t, http.MethodPost, server.URL+"/api/accounts", map[string]any{
		"name":         " ",
		"opening_date": "2026-01-01",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestEntriesEndpoints(t *testing.T) {
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

	server := newTestAPIServer(t, db)

	resp := doJSON(t, http.MethodPost, server.URL+"/api/entries", map[string]any{
		"entry_date":      "2026-01-05",
		"name":            "Transfer",
		"amount_cents":    500,
		"src_account_id":  acct1,
		"dest_account_id": acct2,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	created := decodeAPIResponse(t, resp)
	entryID := mustInt64(t, mustMap(t, created.Data)["id"])

	updateResp := doJSON(t, http.MethodPut, server.URL+"/api/entries/"+fmtInt64(entryID), map[string]any{
		"entry_date":     "2026-01-06",
		"name":           "Updated",
		"amount_cents":   750,
		"src_account_id": acct1,
	})
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", updateResp.StatusCode)
	}

	entriesResp, err := http.Get(server.URL + "/api/entries")
	if err != nil {
		t.Fatalf("get entries: %v", err)
	}
	if entriesResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", entriesResp.StatusCode)
	}
	list := decodeAPIResponse(t, entriesResp)
	rows := mustList(t, list.Data)
	if len(rows) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(rows))
	}
	row := mustMap(t, rows[0])
	if row["name"] != "Updated" {
		t.Fatalf("expected entry name Updated, got %v", row["name"])
	}
	if amt := mustInt64(t, row["amount_cents"]); amt != 750 {
		t.Fatalf("expected amount 750, got %d", amt)
	}
}

func TestEntriesValidation(t *testing.T) {
	db := newTestDB(t)

	res, err := db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Checking", "2026-01-01", int64(10000),
	)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acct1, _ := res.LastInsertId()

	server := newTestAPIServer(t, db)

	resp := doJSON(t, http.MethodPost, server.URL+"/api/entries", map[string]any{
		"entry_date":      "2026-01-05",
		"name":            "BadTransfer",
		"amount_cents":    500,
		"src_account_id":  acct1,
		"dest_account_id": acct1,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestSchedulesOccurrencesAndRevisions(t *testing.T) {
	db := newTestDB(t)

	res, err := db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Income", "2026-01-01", int64(0),
	)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acctID, _ := res.LastInsertId()

	server := newTestAPIServer(t, db)

	schedResp := doJSON(t, http.MethodPost, server.URL+"/api/schedules", map[string]any{
		"name":            "Salary",
		"kind":            "I",
		"amount_cents":    1000,
		"dest_account_id": acctID,
		"start_date":      "2026-01-01",
		"freq":            "M",
		"interval":        1,
	})
	if schedResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", schedResp.StatusCode)
	}
	sched := decodeAPIResponse(t, schedResp)
	schedData := mustMap(t, sched.Data)
	schedID := mustInt64(t, schedData["id"])

	revResp := doJSON(t, http.MethodPost, server.URL+"/api/revisions", map[string]any{
		"schedule_id":    schedID,
		"effective_date": "2026-02-01",
		"amount_cents":   2000,
	})
	if revResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", revResp.StatusCode)
	}

	occResp, err := http.Get(server.URL + "/api/occurrences?from_date=2026-01-01&to_date=2026-02-15")
	if err != nil {
		t.Fatalf("get occurrences: %v", err)
	}
	if occResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", occResp.StatusCode)
	}
	occ := decodeAPIResponse(t, occResp)
	rows := mustList(t, occ.Data)
	if len(rows) < 2 {
		t.Fatalf("expected at least 2 occurrences, got %d", len(rows))
	}

	var salary []map[string]any
	for _, item := range rows {
		row := mustMap(t, item)
		if row["name"] == "Salary" {
			salary = append(salary, row)
		}
	}
	if len(salary) < 2 {
		t.Fatalf("expected salary occurrences, got %d", len(salary))
	}
	if amt := mustInt64(t, salary[0]["amount_cents"]); amt != 1000 {
		t.Fatalf("expected first amount 1000, got %d", amt)
	}
	if amt := mustInt64(t, salary[1]["amount_cents"]); amt != 2000 {
		t.Fatalf("expected revised amount 2000, got %d", amt)
	}
}

func TestRevisionsDelete(t *testing.T) {
	db := newTestDB(t)

	res, err := db.Exec(
		"INSERT INTO account (name, opening_date, opening_balance_cents) VALUES (?, ?, ?)",
		"Income", "2026-01-01", int64(0),
	)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	acctID, _ := res.LastInsertId()

	server := newTestAPIServer(t, db)

	schedResp := doJSON(t, http.MethodPost, server.URL+"/api/schedules", map[string]any{
		"name":            "Salary",
		"kind":            "I",
		"amount_cents":    1000,
		"dest_account_id": acctID,
		"start_date":      "2026-01-01",
		"freq":            "M",
		"interval":        1,
	})
	if schedResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", schedResp.StatusCode)
	}
	sched := decodeAPIResponse(t, schedResp)
	schedID := mustInt64(t, mustMap(t, sched.Data)["id"])

	revResp := doJSON(t, http.MethodPost, server.URL+"/api/revisions", map[string]any{
		"schedule_id":    schedID,
		"effective_date": "2026-02-01",
		"amount_cents":   2000,
	})
	if revResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", revResp.StatusCode)
	}
	rev := decodeAPIResponse(t, revResp)
	revID := mustInt64(t, mustMap(t, rev.Data)["id"])

	listResp, err := http.Get(server.URL + "/api/revisions")
	if err != nil {
		t.Fatalf("get revisions: %v", err)
	}
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.StatusCode)
	}
	list := decodeAPIResponse(t, listResp)
	if len(mustList(t, list.Data)) != 1 {
		t.Fatalf("expected 1 revision")
	}

	deleteReq, err := http.NewRequest(http.MethodDelete, server.URL+"/api/revisions/"+fmtInt64(revID), nil)
	if err != nil {
		t.Fatalf("new delete request: %v", err)
	}
	deleteResp, err := http.DefaultClient.Do(deleteReq)
	if err != nil {
		t.Fatalf("delete revision: %v", err)
	}
	if deleteResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", deleteResp.StatusCode)
	}

	listResp2, err := http.Get(server.URL + "/api/revisions")
	if err != nil {
		t.Fatalf("get revisions: %v", err)
	}
	if listResp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp2.StatusCode)
	}
	list2 := decodeAPIResponse(t, listResp2)
	if len(mustList(t, list2.Data)) != 0 {
		t.Fatalf("expected 0 revisions")
	}
}

func TestBalancesSeriesValidation(t *testing.T) {
	db := newTestDB(t)
	server := newTestAPIServer(t, db)

	resp, err := http.Get(server.URL + "/api/balances/series?mode=actual&from_date=2026-01-01&to_date=2026-01-02&include_interest=1")
	if err != nil {
		t.Fatalf("get balances series: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func fmtInt64(v int64) string {
	return strconv.FormatInt(v, 10)
}
