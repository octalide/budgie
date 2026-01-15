package budgie

import "testing"

func TestRequireDate(t *testing.T) {
	if v, err := requireDate("2026-01-14", "when"); err != nil || v != "2026-01-14" {
		t.Fatalf("expected valid date, got %v, %v", v, err)
	}
	if _, err := requireDate("01-14-2026", "when"); err == nil {
		t.Fatalf("expected error for invalid date")
	}
}

func TestOptionalDate(t *testing.T) {
	if v, err := optionalDate(nil, "when"); err != nil || v != nil {
		t.Fatalf("expected nil date, got %v, %v", v, err)
	}
	empty := "  "
	if v, err := optionalDate(&empty, "when"); err != nil || v != nil {
		t.Fatalf("expected nil for empty date, got %v, %v", v, err)
	}
	valid := "2026-02-01"
	if v, err := optionalDate(&valid, "when"); err != nil || v == nil || *v != valid {
		t.Fatalf("expected valid date, got %v, %v", v, err)
	}
	bad := "2026/02/01"
	if _, err := optionalDate(&bad, "when"); err == nil {
		t.Fatalf("expected error for invalid date")
	}
}

func TestParseIDFromPath(t *testing.T) {
	if id, ok := parseIDFromPath("/api/accounts/", "/api/accounts/123"); !ok || id != 123 {
		t.Fatalf("expected id 123, got %v, %v", id, ok)
	}
	if _, ok := parseIDFromPath("/api/accounts/", "/api/other/123"); ok {
		t.Fatalf("expected prefix mismatch to fail")
	}
	if _, ok := parseIDFromPath("/api/accounts/", "/api/accounts/"); ok {
		t.Fatalf("expected empty id to fail")
	}
	if _, ok := parseIDFromPath("/api/accounts/", "/api/accounts/abc"); ok {
		t.Fatalf("expected non-numeric id to fail")
	}
}
