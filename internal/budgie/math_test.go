package budgie

import (
	"math"
	"testing"
	"time"
)

func d(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestInterestForPeriodCents(t *testing.T) {
	// Zero interest for zero APR.
	if got := interestForPeriodCents(10000, 0, "D", d("2025-01-01"), d("2025-01-11")); got != 0 {
		t.Fatalf("expected zero interest for apr=0, got %d", got)
	}
	// Zero interest for same from/to.
	if got := interestForPeriodCents(10000, 1200, "D", d("2025-01-01"), d("2025-01-01")); got != 0 {
		t.Fatalf("expected zero interest for same date, got %d", got)
	}

	pos := interestForPeriodCents(100000, 1200, "D", d("2025-01-01"), d("2025-01-31"))
	if pos <= 0 {
		t.Fatalf("expected positive interest, got %d", pos)
	}
	neg := interestForPeriodCents(-100000, 1200, "D", d("2025-01-01"), d("2025-01-31"))
	if neg >= 0 {
		t.Fatalf("expected negative interest, got %d", neg)
	}

	big := interestForPeriodCents(10000, 10000, "D", d("2025-01-01"), d("2026-01-01"))
	if big < 10000 {
		t.Fatalf("expected sizable interest for 100%% APR, got %d", big)
	}

	daily := interestForPeriodCents(10000000, 2400, "D", d("2025-01-01"), d("2025-02-15"))
	monthly := interestForPeriodCents(10000000, 2400, "M", d("2025-01-01"), d("2025-02-15"))
	if daily == monthly {
		t.Fatalf("expected daily and monthly compounding to differ")
	}

	fallback := interestForPeriodCents(100000, 1200, "X", d("2025-01-01"), d("2025-01-31"))
	dailyDefault := interestForPeriodCents(100000, 1200, "D", d("2025-01-01"), d("2025-01-31"))
	if fallback != dailyDefault {
		t.Fatalf("expected unknown compound to default to daily")
	}
}

func TestWholeMonthsAndRemainder(t *testing.T) {
	tests := []struct {
		from, to       string
		wantMonths     int
		wantRemainDays int
	}{
		{"2025-01-31", "2025-02-28", 1, 0},
		{"2025-03-01", "2025-03-31", 0, 30},
		{"2025-01-15", "2025-04-15", 3, 0},
		{"2025-01-15", "2025-04-20", 3, 5},
		{"2024-01-29", "2024-02-29", 1, 0},
		{"2024-02-29", "2025-02-28", 12, 0},
	}
	for _, tt := range tests {
		months, days := wholeMonthsAndRemainder(d(tt.from), d(tt.to))
		if months != tt.wantMonths || days != tt.wantRemainDays {
			t.Errorf("wholeMonthsAndRemainder(%s, %s) = (%d, %d), want (%d, %d)",
				tt.from, tt.to, months, days, tt.wantMonths, tt.wantRemainDays)
		}
	}
}

func TestMonthlyCompoundingCalendarAccuracy(t *testing.T) {
	balance := int64(10000000) // $100,000.00
	apr := int64(1200)         // 12%

	// Jan 31 -> Feb 28: exactly 1 calendar month of compounding (28 days)
	jan31toFeb28 := interestForPeriod(balance, apr, "M", d("2025-01-31"), d("2025-02-28"))
	// Mar 1 -> Mar 31: 0 whole months + 30 remainder days
	mar1toMar31 := interestForPeriod(balance, apr, "M", d("2025-03-01"), d("2025-03-31"))

	// Jan 31 -> Feb 28 should give exactly 1 month of compounding
	// Expected: balance * (1 + 0.12/12)^1 - balance = balance * 0.01
	expectedOneMonth := float64(balance) * 0.01
	if math.Abs(jan31toFeb28-expectedOneMonth) > 0.01 {
		t.Errorf("Jan31->Feb28: got %.2f, want %.2f (exactly 1 month)", jan31toFeb28, expectedOneMonth)
	}

	// Mar 1 -> Mar 31 is 0 whole months + 30 remainder days, should differ from 1 month
	if math.Abs(mar1toMar31-expectedOneMonth) < 1.0 {
		t.Errorf("Mar1->Mar31 should differ from exactly 1 month: got %.2f", mar1toMar31)
	}
}

func TestProjectionStartDate(t *testing.T) {
	now := time.Now()
	fmtDate := func(v time.Time) string {
		return v.Format("2006-01-02")
	}
	today := fmtDate(now)

	fromPast := fmtDate(now.AddDate(0, 0, -3))
	asOfFuture := fmtDate(now.AddDate(0, 0, 5))
	if got := projectionStartDate(fromPast, asOfFuture); got != fromPast {
		t.Fatalf("expected start %s, got %s", fromPast, got)
	}

	fromFuture := fmtDate(now.AddDate(0, 0, 5))
	asOfLater := fmtDate(now.AddDate(0, 0, 10))
	if got := projectionStartDate(fromFuture, asOfLater); got != today {
		t.Fatalf("expected start %s, got %s", today, got)
	}

	asOfPast := fmtDate(now.AddDate(0, 0, -2))
	if got := projectionStartDate(fromFuture, asOfPast); got != asOfPast {
		t.Fatalf("expected start %s, got %s", asOfPast, got)
	}
}
