package budgie

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type oidcMetadata struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
}

type jwkKey struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksResponse struct {
	Keys []jwkKey `json:"keys"`
}

type jwksCache struct {
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

type flexBool bool

func (f *flexBool) UnmarshalJSON(data []byte) error {
	s := strings.Trim(string(data), `"`)
	switch strings.ToLower(s) {
	case "true", "1":
		*f = true
	case "false", "0", "null", "":
		*f = false
	default:
		return fmt.Errorf("invalid bool value: %s", s)
	}
	return nil
}

type oidcClaims struct {
	Iss               string   `json:"iss"`
	Sub               string   `json:"sub"`
	Aud               any      `json:"aud"`
	Exp               int64    `json:"exp"`
	Nonce             string   `json:"nonce"`
	Email             string   `json:"email"`
	EmailVerified     flexBool `json:"email_verified"`
	Name              string   `json:"name"`
	PreferredUsername string   `json:"preferred_username"`
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	Typ string `json:"typ"`
}

func (a *AuthService) initOIDC(ctx context.Context) error {
	meta, err := fetchOIDCMetadata(ctx, a.httpClient, a.cfg.OIDCIssuer)
	if err != nil {
		return err
	}
	if meta.AuthorizationEndpoint == "" || meta.TokenEndpoint == "" || meta.JWKSURI == "" {
		return fmt.Errorf("OIDC discovery missing endpoints")
	}
	issuer := normalizeIssuer(a.cfg.OIDCIssuer)
	if meta.Issuer != "" && normalizeIssuer(meta.Issuer) != issuer {
		return fmt.Errorf("OIDC issuer mismatch")
	}
	if meta.Issuer != "" {
		issuer = normalizeIssuer(meta.Issuer)
	}
	a.cfg.OIDCIssuer = issuer
	a.oidcAuthURL = meta.AuthorizationEndpoint
	a.oidcTokenURL = meta.TokenEndpoint
	a.oidcJWKSURL = meta.JWKSURI
	return nil
}

func (a *AuthService) buildOIDCAuthURL(state string, nonce string) (string, error) {
	if a.oidcAuthURL == "" {
		return "", errors.New("OIDC not configured")
	}
	u, err := url.Parse(a.oidcAuthURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("client_id", a.cfg.OIDCClientID)
	q.Set("redirect_uri", a.cfg.OIDCRedirect)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(a.cfg.OIDCScopes, " "))
	q.Set("state", state)
	if nonce != "" {
		q.Set("nonce", nonce)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (a *AuthService) exchangeOIDCCode(ctx context.Context, code string) (string, error) {
	if a.oidcTokenURL == "" {
		return "", errors.New("OIDC not configured")
	}
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", a.cfg.OIDCRedirect)
	data.Set("client_id", a.cfg.OIDCClientID)
	data.Set("client_secret", a.cfg.OIDCSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.oidcTokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("token endpoint error (%d)", resp.StatusCode)
	}
	var tokenResp struct {
		IDToken          string `json:"id_token"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", err
	}
	if tokenResp.Error != "" {
		return "", fmt.Errorf("oidc error: %s", tokenResp.ErrorDescription)
	}
	if tokenResp.IDToken == "" {
		return "", fmt.Errorf("missing id_token")
	}
	return tokenResp.IDToken, nil
}

func (a *AuthService) verifyOIDCIdToken(ctx context.Context, idToken string, expectedNonce string) (*oidcClaims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}
	headBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid token header")
	}
	var header jwtHeader
	if err := json.Unmarshal(headBytes, &header); err != nil {
		return nil, fmt.Errorf("invalid token header")
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported alg %s", header.Alg)
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid token payload")
	}
	var claims oidcClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("invalid token claims")
	}

	if normalizeIssuer(claims.Iss) != normalizeIssuer(a.cfg.OIDCIssuer) {
		return nil, fmt.Errorf("issuer mismatch")
	}
	if !audMatches(claims.Aud, a.cfg.OIDCClientID) {
		return nil, fmt.Errorf("audience mismatch")
	}
	if claims.Exp == 0 || time.Now().Unix() > claims.Exp-60 {
		return nil, fmt.Errorf("token expired")
	}
	if expectedNonce != "" && claims.Nonce != expectedNonce {
		return nil, fmt.Errorf("nonce mismatch")
	}

	pubKey, err := a.getOIDCPublicKey(ctx, header.Kid)
	if err != nil {
		return nil, err
	}
	if err := verifyJWTSignature(pubKey, parts[0], parts[1], parts[2]); err != nil {
		return nil, err
	}
	return &claims, nil
}

func verifyJWTSignature(pub *rsa.PublicKey, headerPart, payloadPart, sigPart string) error {
	sig, err := base64.RawURLEncoding.DecodeString(sigPart)
	if err != nil {
		return fmt.Errorf("invalid signature")
	}
	message := headerPart + "." + payloadPart
	h := sha256.Sum256([]byte(message))
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, h[:], sig); err != nil {
		return fmt.Errorf("signature verification failed")
	}
	return nil
}

func (a *AuthService) getOIDCPublicKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	a.jwksMu.Lock()
	needsRefresh := a.jwks == nil || time.Since(a.jwks.fetchedAt) > 24*time.Hour
	if !needsRefresh && kid != "" {
		if _, ok := a.jwks.keys[kid]; !ok {
			needsRefresh = true
		}
	}
	if !needsRefresh {
		defer a.jwksMu.Unlock()
		// Return from cache
		if a.jwks == nil || len(a.jwks.keys) == 0 {
			return nil, fmt.Errorf("no jwks keys available")
		}
		if kid == "" {
			for _, k := range a.jwks.keys {
				return k, nil
			}
		}
		if key, ok := a.jwks.keys[kid]; ok {
			return key, nil
		}
		return nil, fmt.Errorf("jwks key not found")
	}
	a.jwksMu.Unlock()

	// Fetch outside the lock
	cache, err := fetchJWKS(ctx, a.httpClient, a.oidcJWKSURL)
	if err != nil {
		return nil, err
	}

	a.jwksMu.Lock()
	defer a.jwksMu.Unlock()
	a.jwks = cache

	if len(a.jwks.keys) == 0 {
		return nil, fmt.Errorf("no jwks keys available")
	}
	if kid == "" {
		for _, k := range a.jwks.keys {
			return k, nil
		}
	}
	if key, ok := a.jwks.keys[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("jwks key not found")
}

func fetchOIDCMetadata(ctx context.Context, client *http.Client, issuer string) (*oidcMetadata, error) {
	issuer = normalizeIssuer(issuer)
	if issuer == "" {
		return nil, fmt.Errorf("missing issuer")
	}
	wellKnown := issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wellKnown, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("OIDC discovery failed (%d)", resp.StatusCode)
	}
	var meta oidcMetadata
	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

func fetchJWKS(ctx context.Context, client *http.Client, jwksURL string) (*jwksCache, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("jwks fetch failed (%d)", resp.StatusCode)
	}
	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, err
	}
	keys := make(map[string]*rsa.PublicKey)
	for _, k := range jwks.Keys {
		pub, err := jwkToPublicKey(k)
		if err != nil {
			continue
		}
		if k.Kid != "" {
			keys[k.Kid] = pub
		} else {
			keys[fmt.Sprintf("key-%d", len(keys))] = pub
		}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("no valid jwks keys")
	}
	return &jwksCache{keys: keys, fetchedAt: time.Now()}, nil
}

func jwkToPublicKey(k jwkKey) (*rsa.PublicKey, error) {
	if k.Kty != "RSA" {
		return nil, errors.New("unsupported key type")
	}
	if k.N == "" || k.E == "" {
		return nil, errors.New("missing key material")
	}
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, err
	}
	n := new(big.Int).SetBytes(nBytes)
	e := 0
	for _, b := range eBytes {
		e = e<<8 + int(b)
	}
	if e == 0 {
		return nil, errors.New("invalid exponent")
	}
	return &rsa.PublicKey{N: n, E: e}, nil
}

func audMatches(aud any, clientID string) bool {
	switch v := aud.(type) {
	case string:
		return v == clientID
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && s == clientID {
				return true
			}
		}
	}
	return false
}

func normalizeIssuer(issuer string) string {
	return strings.TrimRight(strings.TrimSpace(issuer), "/")
}
