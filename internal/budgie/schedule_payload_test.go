package budgie

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newJSONRequest(t *testing.T, payload string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(payload))
}

func TestParseSchedulePayloadValid(t *testing.T) {
	req := newJSONRequest(t, `{"name":"Rent","kind":"E","amount_cents":120000,"src_account_id":1,"start_date":"2026-01-01","freq":"M","interval":0}`)
	p, err := parseSchedulePayload(req)
	if err != nil {
		t.Fatalf("expected valid payload, got %v", err)
	}
	if p.Interval != 1 {
		t.Fatalf("expected interval default to 1, got %d", p.Interval)
	}
	if p.Kind != "E" || p.SrcAccountID == nil || *p.SrcAccountID != 1 {
		t.Fatalf("unexpected payload values: %+v", p)
	}
}

func TestParseSchedulePayloadInvalid(t *testing.T) {
	cases := []string{
		`{"name":"","kind":"E","amount_cents":120000,"src_account_id":1,"start_date":"2026-01-01","freq":"M"}`,
		`{"name":"Pay","kind":"X","amount_cents":120000,"src_account_id":1,"start_date":"2026-01-01","freq":"M"}`,
		`{"name":"Pay","kind":"E","amount_cents":0,"src_account_id":1,"start_date":"2026-01-01","freq":"M"}`,
		`{"name":"Pay","kind":"E","amount_cents":120000,"src_account_id":1,"start_date":"2026-01-01","freq":"M","byweekday":7}`,
		`{"name":"Pay","kind":"T","amount_cents":120000,"src_account_id":1,"dest_account_id":1,"start_date":"2026-01-01","freq":"M"}`,
	}
	for _, payload := range cases {
		req := newJSONRequest(t, payload)
		if _, err := parseSchedulePayload(req); err == nil {
			t.Fatalf("expected error for payload: %s", payload)
		}
	}
}
