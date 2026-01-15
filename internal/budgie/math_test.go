package budgie

import (
	"testing"
	"time"
)

func TestInterestForPeriodCents(t *testing.T) {
	if got := interestForPeriodCents(10000, 0, "D", 10); got != 0 {
		t.Fatalf("expected zero interest for apr=0, got %d", got)
	}
	if got := interestForPeriodCents(10000, 1200, "D", 0); got != 0 {
		t.Fatalf("expected zero interest for days=0, got %d", got)
	}

	pos := interestForPeriodCents(100000, 1200, "D", 30)
	if pos <= 0 {
		t.Fatalf("expected positive interest, got %d", pos)
	}
	neg := interestForPeriodCents(-100000, 1200, "D", 30)
	if neg >= 0 {
		t.Fatalf("expected negative interest, got %d", neg)
	}

	daily := interestForPeriodCents(10000000, 2400, "D", 45)
	monthly := interestForPeriodCents(10000000, 2400, "M", 45)
	if daily == monthly {
		t.Fatalf("expected daily and monthly compounding to differ")
	}

	fallback := interestForPeriodCents(100000, 1200, "X", 30)
	dailyDefault := interestForPeriodCents(100000, 1200, "D", 30)
	if fallback != dailyDefault {
		t.Fatalf("expected unknown compound to default to daily")
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
