package budgie

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

type ctxKey int

const (
	ctxUserKey ctxKey = iota
	ctxSessionKey
)

func userFromContext(ctx context.Context) *userInfo {
	if v := ctx.Value(ctxUserKey); v != nil {
		if u, ok := v.(*userInfo); ok {
			return u
		}
	}
	return nil
}

func sessionFromContext(ctx context.Context) *sessionInfo {
	if v := ctx.Value(ctxSessionKey); v != nil {
		if s, ok := v.(*sessionInfo); ok {
			return s
		}
	}
	return nil
}

func (s *server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.auth == nil {
			next(w, r)
			return
		}
		sess, user, err := s.auth.sessionFromRequest(r)
		if err != nil {
			if errors.Is(err, errNoSession) {
				writeErr(w, unauthorized("authentication required"))
				return
			}
			writeErr(w, serverError("failed to read session", err))
			return
		}
		if !isSafeMethod(r.Method) {
			if !s.auth.sameOrigin(r) {
				writeErr(w, forbidden("origin mismatch"))
				return
			}
			csrf := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
			if csrf == "" || csrf != sess.CSRFToken {
				writeErr(w, forbidden("csrf token missing or invalid"))
				return
			}
		}
		ctx := context.WithValue(r.Context(), ctxUserKey, user)
		ctx = context.WithValue(ctx, ctxSessionKey, sess)
		next(w, r.WithContext(ctx))
	}
}

func isSafeMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

func (s *server) session(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.auth == nil {
		writeOK(w, map[string]any{
			"user": nil,
			"auth": map[string]any{"enabled": false},
		})
		return
	}
	cfg := s.auth.Config()
	allowSignup, err := s.auth.allowSignup()
	if err != nil {
		writeErr(w, serverError("failed to check signup", err))
		return
	}
	payload := map[string]any{
		"user": nil,
		"auth": map[string]any{
			"enabled":       true,
			"allow_signup":  allowSignup,
			"password_min":  cfg.PasswordMin,
			"oidc_enabled":  cfg.OIDCEnabled,
			"oidc_provider": cfg.OIDCProvider,
		},
	}
	if sess, user, err := s.auth.sessionFromRequest(r); err == nil {
		payload["user"] = user
		payload["csrf_token"] = sess.CSRFToken
	} else if !errors.Is(err, errNoSession) {
		writeErr(w, serverError("failed to read session", err))
		return
	}
	writeOK(w, payload)
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.auth == nil {
		writeErr(w, serverError("auth not configured", errors.New("auth disabled")))
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if e := readJSON(r, &body); e != nil {
		writeErr(w, e)
		return
	}
	if strings.TrimSpace(body.Email) == "" || strings.TrimSpace(body.Password) == "" {
		writeErr(w, badRequest("email and password are required", nil))
		return
	}

	userID, hash, err := s.auth.getPasswordHash(body.Email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, unauthorized("invalid credentials"))
			return
		}
		writeErr(w, serverError("failed to load credentials", err))
		return
	}
	ok, err := verifyPassword(body.Password, hash)
	if err != nil {
		writeErr(w, serverError("failed to verify password", err))
		return
	}
	if !ok {
		writeErr(w, unauthorized("invalid credentials"))
		return
	}
	_, _ = s.auth.db.Exec(`UPDATE user SET last_login_at = strftime('%s','now') WHERE id = ?`, userID)

	sess, raw, err := s.auth.createSession(userID, r)
	if err != nil {
		writeErr(w, serverError("failed to create session", err))
		return
	}
	s.auth.setSessionCookie(w, r, raw, sess.ExpiresAt)

	user, err := s.auth.userInfoByID(userID)
	if err != nil {
		writeErr(w, serverError("failed to load user", err))
		return
	}
	writeOK(w, map[string]any{"user": user, "csrf_token": sess.CSRFToken})
}

func (s *server) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.auth == nil {
		writeErr(w, serverError("auth not configured", errors.New("auth disabled")))
		return
	}
	allowSignup, err := s.auth.allowSignup()
	if err != nil {
		writeErr(w, serverError("failed to check signup", err))
		return
	}
	if !allowSignup {
		writeErr(w, forbidden("signups are disabled"))
		return
	}
	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if e := readJSON(r, &body); e != nil {
		writeErr(w, e)
		return
	}
	email := strings.TrimSpace(body.Email)
	if email == "" || strings.TrimSpace(body.Password) == "" {
		writeErr(w, badRequest("email and password are required", nil))
		return
	}
	if len(body.Password) < s.auth.Config().PasswordMin {
		writeErr(w, badRequest("password is too short", map[string]any{"min": s.auth.Config().PasswordMin}))
		return
	}

	if _, err := s.auth.userInfoByEmail(email); err == nil {
		writeErr(w, badRequest("email already registered", nil))
		return
	} else if !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, serverError("failed to check user", err))
		return
	}

	userID, err := s.auth.createUser(email, body.DisplayName)
	if err != nil {
		writeErr(w, badRequest("could not create user", map[string]any{"error": err.Error()}))
		return
	}
	if err := s.auth.setPassword(userID, body.Password); err != nil {
		writeErr(w, serverError("failed to set password", err))
		return
	}
	_, _ = s.auth.db.Exec(`UPDATE user SET last_login_at = strftime('%s','now') WHERE id = ?`, userID)

	sess, raw, err := s.auth.createSession(userID, r)
	if err != nil {
		writeErr(w, serverError("failed to create session", err))
		return
	}
	s.auth.setSessionCookie(w, r, raw, sess.ExpiresAt)

	user, err := s.auth.userInfoByID(userID)
	if err != nil {
		writeErr(w, serverError("failed to load user", err))
		return
	}
	writeOK(w, map[string]any{"user": user, "csrf_token": sess.CSRFToken})
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.auth != nil {
		if sess, _, err := s.auth.sessionFromRequest(r); err == nil {
			_ = s.auth.deleteSession(sess.ID)
		}
		s.auth.clearSessionCookie(w, r)
	}
	writeOK(w, map[string]any{"signed_out": true})
}

func (s *server) oidcLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.auth == nil || !s.auth.Config().OIDCEnabled {
		writeErr(w, notFound("OIDC not configured"))
		return
	}
	link := false
	if v := strings.TrimSpace(r.URL.Query().Get("link")); v != "" {
		v = strings.ToLower(v)
		link = v == "1" || v == "true" || v == "yes" || v == "on"
	}
	var userID *int64
	purpose := "login"
	if link {
		sess, user, err := s.auth.sessionFromRequest(r)
		if err != nil || sess == nil || user == nil {
			writeErr(w, unauthorized("authentication required"))
			return
		}
		purpose = "link"
		userID = &user.ID
	}

	state, nonce, err := s.auth.createOIDCState(purpose, userID)
	if err != nil {
		writeErr(w, serverError("failed to start OIDC", err))
		return
	}
	authURL, err := s.auth.buildOIDCAuthURL(state, nonce)
	if err != nil {
		writeErr(w, serverError("failed to build OIDC URL", err))
		return
	}
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (s *server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if s.auth == nil || !s.auth.Config().OIDCEnabled {
		writeErr(w, notFound("OIDC not configured"))
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if state == "" || code == "" {
		writeErr(w, badRequest("missing state or code", nil))
		return
	}
	stateInfo, err := s.auth.consumeOIDCState(state)
	if err != nil {
		writeErr(w, badRequest("invalid OIDC state", map[string]any{"error": err.Error()}))
		return
	}
	if stateInfo.Purpose != "login" && stateInfo.Purpose != "link" {
		writeErr(w, badRequest("invalid OIDC state", nil))
		return
	}

	idToken, err := s.auth.exchangeOIDCCode(r.Context(), code)
	if err != nil {
		writeErr(w, serverError("OIDC exchange failed", err))
		return
	}
	claims, err := s.auth.verifyOIDCIdToken(r.Context(), idToken, stateInfo.Nonce)
	if err != nil {
		writeErr(w, badRequest("invalid ID token", map[string]any{"error": err.Error()}))
		return
	}

	issuer := claims.Iss
	subject := claims.Sub
	if issuer == "" || subject == "" {
		writeErr(w, badRequest("invalid token subject", nil))
		return
	}

	email := strings.TrimSpace(claims.Email)
	name := strings.TrimSpace(claims.Name)
	if name == "" {
		name = strings.TrimSpace(claims.PreferredUsername)
	}
	if name == "" {
		name = email
	}

	var userID int64
	tx, err := s.auth.db.Begin()
	if err != nil {
		writeErr(w, serverError("failed to open transaction", err))
		return
	}
	defer tx.Rollback()

	var existingUserID sql.NullInt64
	err = tx.QueryRow(`SELECT user_id FROM user_oidc_identity WHERE issuer = ? AND subject = ?`, issuer, subject).Scan(&existingUserID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, serverError("failed to load identity", err))
		return
	}

	if stateInfo.Purpose == "link" {
		if stateInfo.UserID == nil {
			writeErr(w, badRequest("missing user for link", nil))
			return
		}
		userID = *stateInfo.UserID
		if existingUserID.Valid && existingUserID.Int64 != userID {
			writeErr(w, badRequest("identity already linked", nil))
			return
		}
		if existingUserID.Valid {
			_, err = tx.Exec(`UPDATE user_oidc_identity SET email = ?, email_verified = ?, last_login_at = strftime('%s','now') WHERE issuer = ? AND subject = ?`, email, boolToInt(claims.EmailVerified), issuer, subject)
		} else {
			_, err = tx.Exec(`
				INSERT INTO user_oidc_identity (user_id, issuer, subject, email, email_verified, last_login_at)
				VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
			`, userID, issuer, subject, email, boolToInt(claims.EmailVerified))
		}
		if err != nil {
			writeErr(w, serverError("failed to link identity", err))
			return
		}
	} else {
		if existingUserID.Valid {
			userID = existingUserID.Int64
			_, err = tx.Exec(`UPDATE user_oidc_identity SET email = ?, email_verified = ?, last_login_at = strftime('%s','now') WHERE issuer = ? AND subject = ?`, email, boolToInt(claims.EmailVerified), issuer, subject)
			if err != nil {
				writeErr(w, serverError("failed to update identity", err))
				return
			}
		} else {
			if email == "" {
				writeErr(w, badRequest("email not provided by provider", nil))
				return
			}
			if !claims.EmailVerified {
				writeErr(w, badRequest("email is not verified", nil))
				return
			}
			err = tx.QueryRow(`SELECT id FROM user WHERE email = ? AND disabled_at IS NULL`, normalizeEmail(email)).Scan(&userID)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					res, err := tx.Exec(`INSERT INTO user (email, display_name) VALUES (?, ?)`, normalizeEmail(email), name)
					if err != nil {
						writeErr(w, serverError("failed to create user", err))
						return
					}
					id, _ := res.LastInsertId()
					userID = id
				} else {
					writeErr(w, serverError("failed to lookup user", err))
					return
				}
			}
			_, err = tx.Exec(`
				INSERT INTO user_oidc_identity (user_id, issuer, subject, email, email_verified, last_login_at)
				VALUES (?, ?, ?, ?, ?, strftime('%s','now'))
			`, userID, issuer, subject, email, boolToInt(claims.EmailVerified))
			if err != nil {
				writeErr(w, serverError("failed to create identity", err))
				return
			}
		}
	}

	_, err = tx.Exec(`UPDATE user SET last_login_at = strftime('%s','now') WHERE id = ?`, userID)
	if err != nil {
		writeErr(w, serverError("failed to update user", err))
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, serverError("failed to finalize login", err))
		return
	}

	sess, raw, err := s.auth.createSession(userID, r)
	if err != nil {
		writeErr(w, serverError("failed to create session", err))
		return
	}
	s.auth.setSessionCookie(w, r, raw, sess.ExpiresAt)

	http.Redirect(w, r, "/#/dashboard", http.StatusFound)
}

func (a *AuthService) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expiresAt int64) {
	cookie := &http.Cookie{
		Name:     a.cfg.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   a.cookieSecure(r),
		SameSite: http.SameSiteLaxMode,
		Expires:  unixToTime(expiresAt),
	}
	http.SetCookie(w, cookie)
}

func (a *AuthService) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	cookie := &http.Cookie{
		Name:     a.cfg.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   a.cookieSecure(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	}
	http.SetCookie(w, cookie)
}

func unixToTime(v int64) (t time.Time) {
	return time.Unix(v, 0)
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
