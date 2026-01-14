package budgie

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var errNoSession = errors.New("no session")

const (
	defaultSessionTTL  = 14 * 24 * time.Hour
	defaultPasswordMin = 12

	pbkdf2Iterations = 200_000
	pbkdf2KeyLen     = 32

	oidcStateTTL = 10 * time.Minute
)

type AuthConfig struct {
	CookieName   string
	SessionTTL   time.Duration
	AllowSignup  bool
	PasswordMin  int
	TrustProxy   bool
	CookieSecure bool
	OIDCEnabled  bool
	OIDCProvider string
	OIDCIssuer   string
	OIDCClientID string
	OIDCSecret   string
	OIDCRedirect string
	OIDCScopes   []string
}

func LoadAuthConfig() (AuthConfig, error) {
	cfg := AuthConfig{
		CookieName:   "budgie_session",
		SessionTTL:   defaultSessionTTL,
		AllowSignup:  parseBoolEnv("BUDGIE_ALLOW_SIGNUP", false),
		PasswordMin:  defaultPasswordMin,
		TrustProxy:   parseBoolEnv("BUDGIE_TRUST_PROXY", false),
		CookieSecure: parseBoolEnv("BUDGIE_COOKIE_SECURE", false),
		OIDCProvider: strings.TrimSpace(os.Getenv("BUDGIE_OIDC_PROVIDER_NAME")),
	}
	if cfg.OIDCProvider == "" {
		cfg.OIDCProvider = "OIDC"
	}
	if ttlStr := strings.TrimSpace(os.Getenv("BUDGIE_SESSION_TTL")); ttlStr != "" {
		d, err := time.ParseDuration(ttlStr)
		if err != nil {
			return cfg, fmt.Errorf("invalid BUDGIE_SESSION_TTL: %w", err)
		}
		cfg.SessionTTL = d
	}
	if minStr := strings.TrimSpace(os.Getenv("BUDGIE_PASSWORD_MIN")); minStr != "" {
		n, err := strconv.Atoi(minStr)
		if err != nil || n < 6 {
			return cfg, fmt.Errorf("invalid BUDGIE_PASSWORD_MIN")
		}
		cfg.PasswordMin = n
	}

	cfg.OIDCIssuer = strings.TrimSpace(os.Getenv("BUDGIE_OIDC_ISSUER"))
	cfg.OIDCClientID = strings.TrimSpace(os.Getenv("BUDGIE_OIDC_CLIENT_ID"))
	cfg.OIDCSecret = strings.TrimSpace(os.Getenv("BUDGIE_OIDC_CLIENT_SECRET"))
	cfg.OIDCRedirect = strings.TrimSpace(os.Getenv("BUDGIE_OIDC_REDIRECT_URL"))
	if scopesStr := strings.TrimSpace(os.Getenv("BUDGIE_OIDC_SCOPES")); scopesStr != "" {
		fields := strings.Split(scopesStr, ",")
		for _, f := range fields {
			v := strings.TrimSpace(f)
			if v != "" {
				cfg.OIDCScopes = append(cfg.OIDCScopes, v)
			}
		}
	}
	if len(cfg.OIDCScopes) == 0 {
		cfg.OIDCScopes = []string{"openid", "email", "profile"}
	}

	if cfg.OIDCIssuer != "" || cfg.OIDCClientID != "" || cfg.OIDCSecret != "" || cfg.OIDCRedirect != "" {
		if cfg.OIDCIssuer == "" || cfg.OIDCClientID == "" || cfg.OIDCSecret == "" || cfg.OIDCRedirect == "" {
			return cfg, fmt.Errorf("OIDC is partially configured; set BUDGIE_OIDC_ISSUER, BUDGIE_OIDC_CLIENT_ID, BUDGIE_OIDC_CLIENT_SECRET, BUDGIE_OIDC_REDIRECT_URL")
		}
		cfg.OIDCEnabled = true
	}

	return cfg, nil
}

type AuthService struct {
	db  *sql.DB
	cfg AuthConfig

	httpClient *http.Client

	oidcAuthURL  string
	oidcTokenURL string
	oidcJWKSURL  string

	jwksMu sync.Mutex
	jwks   *jwksCache
}

func NewAuthService(ctx context.Context, db *sql.DB, cfg AuthConfig) (*AuthService, error) {
	svc := &AuthService{
		db:         db,
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
	if cfg.OIDCEnabled {
		if err := svc.initOIDC(ctx); err != nil {
			return nil, err
		}
	}
	return svc, nil
}

func (a *AuthService) Config() AuthConfig {
	return a.cfg
}

func parseBoolEnv(key string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	s := strings.ToLower(v)
	return s == "1" || s == "true" || s == "yes" || s == "on"
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func randomToken(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

type sessionInfo struct {
	ID        string
	UserID    int64
	CSRFToken string
	ExpiresAt int64
}

type userInfo struct {
	ID          int64  `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	HasPassword bool   `json:"has_password"`
	OIDCLinked  bool   `json:"oidc_linked"`
}

func (a *AuthService) userInfoByID(id int64) (*userInfo, error) {
	var (
		email       string
		displayName sql.NullString
		hasPassword int
		oidcLinked  int
	)
	err := a.db.QueryRow(`
		SELECT
			u.email,
			u.display_name,
			EXISTS(SELECT 1 FROM user_password p WHERE p.user_id = u.id),
			EXISTS(SELECT 1 FROM user_oidc_identity o WHERE o.user_id = u.id)
		FROM user u
		WHERE u.id = ? AND u.disabled_at IS NULL
	`, id).Scan(&email, &displayName, &hasPassword, &oidcLinked)
	if err != nil {
		return nil, err
	}
	name := displayName.String
	if strings.TrimSpace(name) == "" {
		name = email
	}
	return &userInfo{ID: id, Email: email, DisplayName: name, HasPassword: hasPassword == 1, OIDCLinked: oidcLinked == 1}, nil
}

func (a *AuthService) userInfoByEmail(email string) (*userInfo, error) {
	email = normalizeEmail(email)
	var id int64
	if err := a.db.QueryRow(`SELECT id FROM user WHERE email = ? AND disabled_at IS NULL`, email).Scan(&id); err != nil {
		return nil, err
	}
	return a.userInfoByID(id)
}

func (a *AuthService) allowSignup() (bool, error) {
	if a.cfg.AllowSignup {
		return true, nil
	}
	var count int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM user`).Scan(&count); err != nil {
		return false, err
	}
	return count == 0, nil
}

func (a *AuthService) createUser(email string, displayName string) (int64, error) {
	email = normalizeEmail(email)
	name := strings.TrimSpace(displayName)
	if name == "" {
		name = email
	}
	res, err := a.db.Exec(`INSERT INTO user (email, display_name) VALUES (?, ?)`, email, name)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (a *AuthService) setPassword(userID int64, password string) error {
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = a.db.Exec(`
		INSERT INTO user_password (user_id, password_hash)
		VALUES (?, ?)
		ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash, updated_at=strftime('%s','now')
	`, userID, hash)
	return err
}

func (a *AuthService) getPasswordHash(email string) (int64, string, error) {
	email = normalizeEmail(email)
	var userID int64
	var hash string
	err := a.db.QueryRow(`
		SELECT u.id, p.password_hash
		FROM user u
		JOIN user_password p ON p.user_id = u.id
		WHERE u.email = ? AND u.disabled_at IS NULL
	`, email).Scan(&userID, &hash)
	if err != nil {
		return 0, "", err
	}
	return userID, hash, nil
}

func (a *AuthService) createSession(userID int64, r *http.Request) (*sessionInfo, string, error) {
	raw, err := randomToken(32)
	if err != nil {
		return nil, "", err
	}
	csrf, err := randomToken(32)
	if err != nil {
		return nil, "", err
	}
	hash := hashToken(raw)
	expiresAt := time.Now().Add(a.cfg.SessionTTL).Unix()
	if _, err := a.db.Exec(`
		INSERT INTO auth_session (id, user_id, expires_at, ip, user_agent, csrf_token)
		VALUES (?, ?, ?, ?, ?, ?)
	`, hash, userID, expiresAt, clientIP(r, a.cfg.TrustProxy), r.UserAgent(), csrf); err != nil {
		return nil, "", err
	}
	return &sessionInfo{ID: hash, UserID: userID, CSRFToken: csrf, ExpiresAt: expiresAt}, raw, nil
}

func (a *AuthService) deleteSession(hash string) error {
	_, err := a.db.Exec(`DELETE FROM auth_session WHERE id = ?`, hash)
	return err
}

func (a *AuthService) sessionFromRequest(r *http.Request) (*sessionInfo, *userInfo, error) {
	if a == nil {
		return nil, nil, errNoSession
	}
	cookie, err := r.Cookie(a.cfg.CookieName)
	if err != nil {
		return nil, nil, errNoSession
	}
	raw := strings.TrimSpace(cookie.Value)
	if raw == "" {
		return nil, nil, errNoSession
	}
	hash := hashToken(raw)

	var (
		userID      int64
		email       string
		displayName sql.NullString
		csrfToken   string
		expiresAt   int64
		hasPassword int
		oidcLinked  int
	)
	err = a.db.QueryRow(`
		SELECT
			s.user_id,
			u.email,
			u.display_name,
			s.csrf_token,
			s.expires_at,
			EXISTS(SELECT 1 FROM user_password p WHERE p.user_id = u.id),
			EXISTS(SELECT 1 FROM user_oidc_identity o WHERE o.user_id = u.id)
		FROM auth_session s
		JOIN user u ON u.id = s.user_id
		WHERE s.id = ?
		  AND s.expires_at > strftime('%s','now')
		  AND u.disabled_at IS NULL
	`, hash).Scan(&userID, &email, &displayName, &csrfToken, &expiresAt, &hasPassword, &oidcLinked)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, errNoSession
		}
		return nil, nil, err
	}
	_, _ = a.db.Exec(`UPDATE auth_session SET last_seen_at = strftime('%s','now') WHERE id = ?`, hash)

	name := displayName.String
	if strings.TrimSpace(name) == "" {
		name = email
	}
	return &sessionInfo{ID: hash, UserID: userID, CSRFToken: csrfToken, ExpiresAt: expiresAt}, &userInfo{
		ID:          userID,
		Email:       email,
		DisplayName: name,
		HasPassword: hasPassword == 1,
		OIDCLinked:  oidcLinked == 1,
	}, nil
}

func (a *AuthService) requestScheme(r *http.Request) string {
	if a != nil && a.cfg.TrustProxy {
		if proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]); proto != "" {
			return strings.ToLower(proto)
		}
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func (a *AuthService) requestHost(r *http.Request) string {
	if a != nil && a.cfg.TrustProxy {
		if host := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); host != "" {
			return host
		}
	}
	return r.Host
}

func (a *AuthService) requestOrigin(r *http.Request) string {
	return a.requestScheme(r) + "://" + a.requestHost(r)
}

func (a *AuthService) sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	return strings.EqualFold(origin, a.requestOrigin(r))
}

func (a *AuthService) cookieSecure(r *http.Request) bool {
	if a != nil && a.cfg.CookieSecure {
		return true
	}
	return a.requestScheme(r) == "https"
}

func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
			parts := strings.Split(xff, ",")
			if len(parts) > 0 {
				return strings.TrimSpace(parts[0])
			}
		}
		if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" {
			return xrip
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := pbkdf2Key([]byte(password), salt, pbkdf2Iterations, pbkdf2KeyLen)
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)
	return fmt.Sprintf("pbkdf2$sha256$i=%d$%s$%s", pbkdf2Iterations, b64Salt, b64Hash), nil
}

func verifyPassword(password string, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 {
		return false, fmt.Errorf("invalid password hash")
	}
	if parts[0] != "pbkdf2" {
		return false, fmt.Errorf("unsupported hash")
	}
	if parts[1] != "sha256" {
		return false, fmt.Errorf("unsupported hash")
	}
	iter := 0
	if strings.HasPrefix(parts[2], "i=") {
		n, err := strconv.Atoi(strings.TrimPrefix(parts[2], "i="))
		if err != nil {
			return false, err
		}
		iter = n
	}
	if iter <= 0 {
		return false, fmt.Errorf("invalid pbkdf2 params")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false, err
	}
	hash, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	calc := pbkdf2Key([]byte(password), salt, iter, len(hash))
	if subtle.ConstantTimeCompare(calc, hash) == 1 {
		return true, nil
	}
	return false, nil
}

func pbkdf2Key(password, salt []byte, iter, keyLen int) []byte {
	hLen := sha256.Size
	numBlocks := (keyLen + hLen - 1) / hLen
	var dk []byte
	for block := 1; block <= numBlocks; block++ {
		u := pbkdf2F(password, salt, iter, block)
		dk = append(dk, u...)
	}
	return dk[:keyLen]
}

func pbkdf2F(password, salt []byte, iter, blockIndex int) []byte {
	var buf [4]byte
	binary.BigEndian.PutUint32(buf[:], uint32(blockIndex))
	u := hmacSHA256(password, append(salt, buf[:]...))
	out := make([]byte, len(u))
	copy(out, u)
	for i := 1; i < iter; i++ {
		u = hmacSHA256(password, u)
		for j := range out {
			out[j] ^= u[j]
		}
	}
	return out
}

func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(data)
	return mac.Sum(nil)
}

type oidcState struct {
	ID        int64
	Nonce     string
	Purpose   string
	UserID    *int64
	CreatedAt int64
}

func (a *AuthService) createOIDCState(purpose string, userID *int64) (string, string, error) {
	state, err := randomToken(24)
	if err != nil {
		return "", "", err
	}
	nonce, err := randomToken(24)
	if err != nil {
		return "", "", err
	}
	hash := hashToken(state)
	var uid any
	if userID != nil {
		uid = *userID
	}
	if _, err := a.db.Exec(`INSERT INTO oidc_state (state_hash, nonce, purpose, user_id) VALUES (?, ?, ?, ?)`, hash, nonce, purpose, uid); err != nil {
		return "", "", err
	}
	return state, nonce, nil
}

func (a *AuthService) consumeOIDCState(state string) (*oidcState, error) {
	hash := hashToken(state)
	var (
		id        int64
		nonce     string
		purpose   string
		userID    sql.NullInt64
		createdAt int64
	)
	err := a.db.QueryRow(`SELECT id, nonce, purpose, user_id, created_at FROM oidc_state WHERE state_hash = ?`, hash).Scan(&id, &nonce, &purpose, &userID, &createdAt)
	if err != nil {
		return nil, err
	}
	_, _ = a.db.Exec(`DELETE FROM oidc_state WHERE id = ?`, id)
	if time.Since(time.Unix(createdAt, 0)) > oidcStateTTL {
		return nil, fmt.Errorf("OIDC state expired")
	}
	var uid *int64
	if userID.Valid {
		v := userID.Int64
		uid = &v
	}
	return &oidcState{ID: id, Nonce: nonce, Purpose: purpose, UserID: uid, CreatedAt: createdAt}, nil
}
