package budgie

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type apiResponse struct {
	OK     bool           `json:"ok"`
	Data   map[string]any `json:"data"`
	Error  string         `json:"error"`
	Detail any            `json:"details"`
}

func decodeResponse(t *testing.T, rr *httptest.ResponseRecorder) apiResponse {
	t.Helper()

	var resp apiResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func TestRegisterLoginSessionFlow(t *testing.T) {
	db := newTestDB(t)
	cfg := AuthConfig{CookieName: "budgie_session", SessionTTL: time.Hour, AllowSignup: true, PasswordMin: 6}
	auth := newTestAuthService(t, db, cfg)
	srv := &server{db: db, auth: auth}

	payload := []byte(`{"email":"user@example.com","password":"password123","display_name":"User"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewBuffer(payload))
	rr := httptest.NewRecorder()
	srv.register(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("register status %d: %s", rr.Code, rr.Body.String())
	}
	resp := decodeResponse(t, rr)
	if !resp.OK {
		t.Fatalf("expected ok response, got %v", resp)
	}
	cookies := rr.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("expected session cookie")
	}

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	sessionReq.AddCookie(cookies[0])
	sessionRR := httptest.NewRecorder()
	srv.session(sessionRR, sessionReq)
	if sessionRR.Code != http.StatusOK {
		t.Fatalf("session status %d: %s", sessionRR.Code, sessionRR.Body.String())
	}
	sessionResp := decodeResponse(t, sessionRR)
	if !sessionResp.OK {
		t.Fatalf("expected ok response, got %v", sessionResp)
	}
	if sessionResp.Data["user"] == nil {
		t.Fatalf("expected session user")
	}

	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBuffer(payload))
	loginRR := httptest.NewRecorder()
	srv.login(loginRR, loginReq)
	if loginRR.Code != http.StatusOK {
		t.Fatalf("login status %d: %s", loginRR.Code, loginRR.Body.String())
	}
	loginResp := decodeResponse(t, loginRR)
	if !loginResp.OK {
		t.Fatalf("expected ok login response, got %v", loginResp)
	}
}

func TestRequireAuthCSRF(t *testing.T) {
	db := newTestDB(t)
	cfg := AuthConfig{CookieName: "budgie_session", SessionTTL: time.Hour, AllowSignup: true, PasswordMin: 6}
	auth := newTestAuthService(t, db, cfg)
	srv := &server{db: db, auth: auth}

	userID, err := auth.createUser("csrf@example.com", "CSRF")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	sessReq := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)
	sess, raw, err := auth.createSession(userID, sessReq)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	h := srv.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		writeOK(w, map[string]any{"ok": true})
	})

	noSessionReq := httptest.NewRequest(http.MethodPost, "/api/accounts", nil)
	noSessionRR := httptest.NewRecorder()
	h(noSessionRR, noSessionReq)
	if noSessionRR.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without session, got %d", noSessionRR.Code)
	}

	missingCSRFReq := httptest.NewRequest(http.MethodPost, "http://example.com/api/accounts", nil)
	missingCSRFReq.AddCookie(&http.Cookie{Name: cfg.CookieName, Value: raw})
	missingCSRFResp := httptest.NewRecorder()
	h(missingCSRFResp, missingCSRFReq)
	if missingCSRFResp.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without csrf, got %d", missingCSRFResp.Code)
	}

	okReq := httptest.NewRequest(http.MethodPost, "http://example.com/api/accounts", nil)
	okReq.AddCookie(&http.Cookie{Name: cfg.CookieName, Value: raw})
	okReq.Header.Set("X-CSRF-Token", sess.CSRFToken)
	okRR := httptest.NewRecorder()
	h(okRR, okReq)
	if okRR.Code != http.StatusOK {
		t.Fatalf("expected 200 with csrf, got %d", okRR.Code)
	}
}
