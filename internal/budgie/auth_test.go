package budgie

import (
	"testing"
	"time"
)

func TestHashPasswordRoundTrip(t *testing.T) {
	hash, err := hashPassword("super-secret")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	ok, err := verifyPassword("super-secret", hash)
	if err != nil {
		t.Fatalf("verify password: %v", err)
	}
	if !ok {
		t.Fatalf("expected password to verify")
	}
	ok, err = verifyPassword("wrong", hash)
	if err != nil {
		t.Fatalf("verify password: %v", err)
	}
	if ok {
		t.Fatalf("expected wrong password to fail")
	}
}

func TestAllowSignup(t *testing.T) {
	db := newTestDB(t)
	cfg := AuthConfig{CookieName: "budgie_session", SessionTTL: time.Hour, AllowSignup: false, PasswordMin: 12}
	auth := newTestAuthService(t, db, cfg)

	allow, err := auth.allowSignup()
	if err != nil {
		t.Fatalf("allowSignup: %v", err)
	}
	if !allow {
		t.Fatalf("expected signup to be allowed with zero users")
	}

	if _, err := auth.createUser("tester@example.com", "Tester"); err != nil {
		t.Fatalf("create user: %v", err)
	}
	allow, err = auth.allowSignup()
	if err != nil {
		t.Fatalf("allowSignup: %v", err)
	}
	if allow {
		t.Fatalf("expected signup to be blocked once a user exists")
	}
}
