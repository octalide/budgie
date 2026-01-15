package budgie

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := WithSecurityHeaders(next, nil)

	req := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("missing X-Frame-Options header")
	}
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("missing X-Content-Type-Options header")
	}
	if rr.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("missing Content-Security-Policy header")
	}
	if rr.Header().Get("Strict-Transport-Security") != "" {
		t.Fatalf("expected no HSTS on http")
	}

	httpsReq := httptest.NewRequest(http.MethodGet, "https://example.com/", nil)
	httpsReq.TLS = &tls.ConnectionState{}
	httpsRR := httptest.NewRecorder()
	h.ServeHTTP(httpsRR, httpsReq)
	if httpsRR.Header().Get("Strict-Transport-Security") == "" {
		t.Fatalf("expected HSTS on https")
	}
}
