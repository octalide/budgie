package budgie

import (
	"database/sql"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type server struct {
	db   *sql.DB
	auth *AuthService
}

func (s *server) meta(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok": true,
		"enums": map[string]any{
			"schedule_kind": []string{"I", "E", "T"},
			"schedule_freq": []string{"D", "W", "M", "Y"},
		},
	})
}

func (s *server) accounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.Query("SELECT * FROM account ORDER BY archived_at IS NOT NULL, name")
		if err != nil {
			writeErr(w, serverError("failed to query accounts", err))
			return
		}
		defer rows.Close()
		data, err := rowsToMaps(rows)
		if err != nil {
			writeErr(w, serverError("failed to read accounts", err))
			return
		}
		writeOK(w, data)
	case http.MethodPost:
		var body struct {
			Name                string  `json:"name"`
			OpeningDate         string  `json:"opening_date"`
			OpeningBalanceCents int64   `json:"opening_balance_cents"`
			Description         *string `json:"description"`
			ArchivedAt          *string `json:"archived_at"`

			IsLiability          int64  `json:"is_liability"`
			IsInterestBearing    int64  `json:"is_interest_bearing"`
			InterestAprBps       *int64 `json:"interest_apr_bps"`
			InterestCompound     string `json:"interest_compound"`
			ExcludeFromDashboard int64  `json:"exclude_from_dashboard"`
		}
		if e := readJSON(r, &body); e != nil {
			writeErr(w, e)
			return
		}
		if strings.TrimSpace(body.Name) == "" {
			writeErr(w, badRequest("name is required", nil))
			return
		}
		od, e := requireDate(body.OpeningDate, "opening_date")
		if e != nil {
			writeErr(w, e)
			return
		}
		archivedAt, e := optionalDate(body.ArchivedAt, "archived_at")
		if e != nil {
			writeErr(w, e)
			return
		}

		if body.IsLiability != 0 {
			body.IsLiability = 1
		}
		if body.IsInterestBearing != 0 {
			body.IsInterestBearing = 1
		}
		if body.ExcludeFromDashboard != 0 {
			body.ExcludeFromDashboard = 1
		}
		if strings.TrimSpace(body.InterestCompound) == "" {
			body.InterestCompound = "D"
		}
		if body.InterestCompound != "D" && body.InterestCompound != "M" {
			writeErr(w, badRequest("interest_compound must be 'D' or 'M'", nil))
			return
		}
		if body.IsInterestBearing == 1 {
			if body.InterestAprBps == nil {
				writeErr(w, badRequest("interest_apr_bps is required when is_interest_bearing=1", nil))
				return
			}
			if *body.InterestAprBps < 0 {
				writeErr(w, badRequest("interest_apr_bps must be >= 0", nil))
				return
			}
		}

		res, err := s.db.Exec(
			"INSERT INTO account (name, opening_date, opening_balance_cents, description, archived_at, is_liability, is_interest_bearing, interest_apr_bps, interest_compound, exclude_from_dashboard) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			strings.TrimSpace(body.Name), od, body.OpeningBalanceCents, body.Description, archivedAt,
			body.IsLiability, body.IsInterestBearing, body.InterestAprBps, body.InterestCompound, body.ExcludeFromDashboard,
		)
		if err != nil {
			writeErr(w, badRequest("could not create account", map[string]any{"sqlite": err.Error()}))
			return
		}
		id, _ := res.LastInsertId()
		created, apiE := scanRowToMap(s.db, "account", id)
		if apiE != nil {
			writeErr(w, apiE)
			return
		}
		writeOK(w, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) accountByID(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDFromPath("/api/accounts/", r.URL.Path)
	if !ok {
		writeErr(w, notFound("not found"))
		return
	}

	switch r.Method {
	case http.MethodPut:
		var body struct {
			Name                string  `json:"name"`
			OpeningDate         string  `json:"opening_date"`
			OpeningBalanceCents int64   `json:"opening_balance_cents"`
			Description         *string `json:"description"`
			ArchivedAt          *string `json:"archived_at"`

			IsLiability          int64  `json:"is_liability"`
			IsInterestBearing    int64  `json:"is_interest_bearing"`
			InterestAprBps       *int64 `json:"interest_apr_bps"`
			InterestCompound     string `json:"interest_compound"`
			ExcludeFromDashboard int64  `json:"exclude_from_dashboard"`
		}
		if e := readJSON(r, &body); e != nil {
			writeErr(w, e)
			return
		}
		if strings.TrimSpace(body.Name) == "" {
			writeErr(w, badRequest("name is required", nil))
			return
		}
		od, e := requireDate(body.OpeningDate, "opening_date")
		if e != nil {
			writeErr(w, e)
			return
		}
		archivedAt, e := optionalDate(body.ArchivedAt, "archived_at")
		if e != nil {
			writeErr(w, e)
			return
		}

		if body.IsLiability != 0 {
			body.IsLiability = 1
		}
		if body.IsInterestBearing != 0 {
			body.IsInterestBearing = 1
		}
		if body.ExcludeFromDashboard != 0 {
			body.ExcludeFromDashboard = 1
		}
		if strings.TrimSpace(body.InterestCompound) == "" {
			body.InterestCompound = "D"
		}
		if body.InterestCompound != "D" && body.InterestCompound != "M" {
			writeErr(w, badRequest("interest_compound must be 'D' or 'M'", nil))
			return
		}
		if body.IsInterestBearing == 1 {
			if body.InterestAprBps == nil {
				writeErr(w, badRequest("interest_apr_bps is required when is_interest_bearing=1", nil))
				return
			}
			if *body.InterestAprBps < 0 {
				writeErr(w, badRequest("interest_apr_bps must be >= 0", nil))
				return
			}
		}

		_, err := s.db.Exec(
			"UPDATE account SET name=?, opening_date=?, opening_balance_cents=?, description=?, archived_at=?, is_liability=?, is_interest_bearing=?, interest_apr_bps=?, interest_compound=?, exclude_from_dashboard=? WHERE id=?",
			strings.TrimSpace(body.Name), od, body.OpeningBalanceCents, body.Description, archivedAt,
			body.IsLiability, body.IsInterestBearing, body.InterestAprBps, body.InterestCompound, body.ExcludeFromDashboard,
			id,
		)
		if err != nil {
			writeErr(w, badRequest("could not update account", map[string]any{"sqlite": err.Error()}))
			return
		}
		updated, apiE := scanRowToMap(s.db, "account", id)
		if apiE != nil {
			writeErr(w, apiE)
			return
		}
		writeOK(w, updated)
	case http.MethodDelete:
		res, err := s.db.Exec("DELETE FROM account WHERE id = ?", id)
		if err != nil {
			writeErr(w, badRequest("could not delete account (likely referenced)", map[string]any{"sqlite": err.Error()}))
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeErr(w, notFound("account not found"))
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) schedules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.Query("SELECT * FROM schedule ORDER BY is_active DESC, start_date DESC, name")
		if err != nil {
			writeErr(w, serverError("failed to query schedules", err))
			return
		}
		defer rows.Close()
		data, err := rowsToMaps(rows)
		if err != nil {
			writeErr(w, serverError("failed to read schedules", err))
			return
		}
		writeOK(w, data)
	case http.MethodPost:
		payload, e := parseSchedulePayload(r)
		if e != nil {
			writeErr(w, e)
			return
		}
		isActive := int64(1)
		if payload.IsActive != nil {
			isActive = *payload.IsActive
		}
		res, err := s.db.Exec(
			`INSERT INTO schedule (
			 name, kind, amount_cents, src_account_id, dest_account_id,
			 start_date, end_date, freq, interval, bymonthday, byweekday,
			 description, is_active
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			payload.Name, payload.Kind, payload.AmountCents, payload.SrcAccountID, payload.DestAccountID,
			payload.StartDate, payload.EndDate, payload.Freq, payload.Interval, payload.ByMonthDay, payload.ByWeekday,
			payload.Description, isActive,
		)
		if err != nil {
			writeErr(w, badRequest("could not create schedule", map[string]any{"sqlite": err.Error()}))
			return
		}
		id, _ := res.LastInsertId()
		created, apiE := scanRowToMap(s.db, "schedule", id)
		if apiE != nil {
			writeErr(w, apiE)
			return
		}
		writeOK(w, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) scheduleByID(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDFromPath("/api/schedules/", r.URL.Path)
	if !ok {
		writeErr(w, notFound("not found"))
		return
	}

	switch r.Method {
	case http.MethodPut:
		payload, e := parseSchedulePayload(r)
		if e != nil {
			writeErr(w, e)
			return
		}
		isActive := int64(1)
		if payload.IsActive != nil {
			isActive = *payload.IsActive
		}
		_, err := s.db.Exec(
			`UPDATE schedule
			SET name=?, kind=?, amount_cents=?, src_account_id=?, dest_account_id=?,
			    start_date=?, end_date=?, freq=?, interval=?, bymonthday=?, byweekday=?,
			    description=?, is_active=?
			WHERE id=?`,
			payload.Name, payload.Kind, payload.AmountCents, payload.SrcAccountID, payload.DestAccountID,
			payload.StartDate, payload.EndDate, payload.Freq, payload.Interval, payload.ByMonthDay, payload.ByWeekday,
			payload.Description, isActive, id,
		)
		if err != nil {
			writeErr(w, badRequest("could not update schedule", map[string]any{"sqlite": err.Error()}))
			return
		}
		updated, apiE := scanRowToMap(s.db, "schedule", id)
		if apiE != nil {
			writeErr(w, apiE)
			return
		}
		writeOK(w, updated)
	case http.MethodDelete:
		res, err := s.db.Exec("DELETE FROM schedule WHERE id = ?", id)
		if err != nil {
			writeErr(w, badRequest("could not delete schedule", map[string]any{"sqlite": err.Error()}))
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeErr(w, notFound("schedule not found"))
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) revisions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.Query(`
			SELECT sr.*, s.name AS schedule_name
			FROM schedule_revision sr
			JOIN schedule s ON s.id = sr.schedule_id
			ORDER BY sr.schedule_id, sr.effective_date
		`)
		if err != nil {
			writeErr(w, serverError("failed to query revisions", err))
			return
		}
		defer rows.Close()
		data, err := rowsToMaps(rows)
		if err != nil {
			writeErr(w, serverError("failed to read revisions", err))
			return
		}
		writeOK(w, data)
	case http.MethodPost:
		var body struct {
			ScheduleID    int64   `json:"schedule_id"`
			EffectiveDate string  `json:"effective_date"`
			AmountCents   int64   `json:"amount_cents"`
			Description   *string `json:"description"`
		}
		if e := readJSON(r, &body); e != nil {
			writeErr(w, e)
			return
		}
		if body.ScheduleID == 0 {
			writeErr(w, badRequest("schedule_id is required", nil))
			return
		}
		ed, e := requireDate(body.EffectiveDate, "effective_date")
		if e != nil {
			writeErr(w, e)
			return
		}
		if body.AmountCents <= 0 {
			writeErr(w, badRequest("amount_cents must be > 0", nil))
			return
		}
		res, err := s.db.Exec(
			"INSERT INTO schedule_revision (schedule_id, effective_date, amount_cents, description) VALUES (?, ?, ?, ?)",
			body.ScheduleID, ed, body.AmountCents, body.Description,
		)
		if err != nil {
			writeErr(w, badRequest("could not create revision", map[string]any{"sqlite": err.Error()}))
			return
		}
		id, _ := res.LastInsertId()
		created, apiE := scanRowToMap(s.db, "schedule_revision", id)
		if apiE != nil {
			writeErr(w, apiE)
			return
		}
		writeOK(w, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) revisionByID(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDFromPath("/api/revisions/", r.URL.Path)
	if !ok {
		writeErr(w, notFound("not found"))
		return
	}
	if r.Method != http.MethodDelete {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	res, err := s.db.Exec("DELETE FROM schedule_revision WHERE id = ?", id)
	if err != nil {
		writeErr(w, badRequest("could not delete revision", map[string]any{"sqlite": err.Error()}))
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeErr(w, notFound("revision not found"))
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *server) entries(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.db.Query(`
			SELECT e.*,
			       sa.name AS src_account_name,
			       da.name AS dest_account_name,
			       s.name  AS schedule_name
			FROM entry e
			LEFT JOIN account sa ON sa.id = e.src_account_id
			LEFT JOIN account da ON da.id = e.dest_account_id
			LEFT JOIN schedule s ON s.id = e.schedule_id
			ORDER BY e.entry_date DESC, e.id DESC
		`)
		if err != nil {
			writeErr(w, serverError("failed to query entries", err))
			return
		}
		defer rows.Close()
		data, err := rowsToMaps(rows)
		if err != nil {
			writeErr(w, serverError("failed to read entries", err))
			return
		}
		writeOK(w, data)
	case http.MethodPost:
		var body struct {
			EntryDate     string  `json:"entry_date"`
			Name          string  `json:"name"`
			AmountCents   int64   `json:"amount_cents"`
			SrcAccountID  *int64  `json:"src_account_id"`
			DestAccountID *int64  `json:"dest_account_id"`
			ScheduleID    *int64  `json:"schedule_id"`
			Description   *string `json:"description"`
		}
		if e := readJSON(r, &body); e != nil {
			writeErr(w, e)
			return
		}
		ed, e := requireDate(body.EntryDate, "entry_date")
		if e != nil {
			writeErr(w, e)
			return
		}
		if strings.TrimSpace(body.Name) == "" {
			writeErr(w, badRequest("name is required", nil))
			return
		}
		if body.AmountCents <= 0 {
			writeErr(w, badRequest("amount_cents must be > 0", nil))
			return
		}
		if body.SrcAccountID == nil && body.DestAccountID == nil {
			writeErr(w, badRequest("must set src_account_id and/or dest_account_id", nil))
			return
		}
		if body.SrcAccountID != nil && body.DestAccountID != nil && *body.SrcAccountID == *body.DestAccountID {
			writeErr(w, badRequest("src_account_id and dest_account_id must differ", nil))
			return
		}

		res, err := s.db.Exec(
			"INSERT INTO entry (entry_date, name, amount_cents, src_account_id, dest_account_id, description, schedule_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
			ed, strings.TrimSpace(body.Name), body.AmountCents, body.SrcAccountID, body.DestAccountID, body.Description, body.ScheduleID,
		)
		if err != nil {
			writeErr(w, badRequest("could not create entry", map[string]any{"sqlite": err.Error()}))
			return
		}
		id, _ := res.LastInsertId()
		created, apiE := scanRowToMap(s.db, "entry", id)
		if apiE != nil {
			writeErr(w, apiE)
			return
		}
		writeOK(w, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) entryByID(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDFromPath("/api/entries/", r.URL.Path)
	if !ok {
		writeErr(w, notFound("not found"))
		return
	}

	switch r.Method {
	case http.MethodPut:
		var body struct {
			EntryDate     string  `json:"entry_date"`
			Name          string  `json:"name"`
			AmountCents   int64   `json:"amount_cents"`
			SrcAccountID  *int64  `json:"src_account_id"`
			DestAccountID *int64  `json:"dest_account_id"`
			ScheduleID    *int64  `json:"schedule_id"`
			Description   *string `json:"description"`
		}
		if e := readJSON(r, &body); e != nil {
			writeErr(w, e)
			return
		}
		ed, e := requireDate(body.EntryDate, "entry_date")
		if e != nil {
			writeErr(w, e)
			return
		}
		if strings.TrimSpace(body.Name) == "" {
			writeErr(w, badRequest("name is required", nil))
			return
		}
		if body.AmountCents <= 0 {
			writeErr(w, badRequest("amount_cents must be > 0", nil))
			return
		}
		if body.SrcAccountID == nil && body.DestAccountID == nil {
			writeErr(w, badRequest("must set src_account_id and/or dest_account_id", nil))
			return
		}
		if body.SrcAccountID != nil && body.DestAccountID != nil && *body.SrcAccountID == *body.DestAccountID {
			writeErr(w, badRequest("src_account_id and dest_account_id must differ", nil))
			return
		}

		_, err := s.db.Exec(
			"UPDATE entry SET entry_date=?, name=?, amount_cents=?, src_account_id=?, dest_account_id=?, description=?, schedule_id=? WHERE id = ?",
			ed, strings.TrimSpace(body.Name), body.AmountCents, body.SrcAccountID, body.DestAccountID, body.Description, body.ScheduleID, id,
		)
		if err != nil {
			writeErr(w, badRequest("could not update entry", map[string]any{"sqlite": err.Error()}))
			return
		}
		updated, apiE := scanRowToMap(s.db, "entry", id)
		if apiE != nil {
			writeErr(w, apiE)
			return
		}
		writeOK(w, updated)
	case http.MethodDelete:
		res, err := s.db.Exec("DELETE FROM entry WHERE id = ?", id)
		if err != nil {
			writeErr(w, badRequest("could not delete entry", map[string]any{"sqlite": err.Error()}))
			return
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			writeErr(w, notFound("entry not found"))
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) occurrences(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from_date")
	to := r.URL.Query().Get("to_date")
	if _, e := requireDate(from, "from_date"); e != nil {
		writeErr(w, e)
		return
	}
	if _, e := requireDate(to, "to_date"); e != nil {
		writeErr(w, e)
		return
	}

	q := occurrenceQuery()
	rows, err := s.db.Query(q, to, from, to)
	if err != nil {
		writeErr(w, serverError("failed to compute occurrences", err))
		return
	}
	defer rows.Close()
	data, err := rowsToMaps(rows)
	if err != nil {
		writeErr(w, serverError("failed to read occurrences", err))
		return
	}
	writeOK(w, data)
}

func (s *server) balances(w http.ResponseWriter, r *http.Request) {
	asOf := r.URL.Query().Get("as_of")
	mode := r.URL.Query().Get("mode")
	from := r.URL.Query().Get("from_date")
	if mode == "" {
		mode = "actual"
	}
	if _, e := requireDate(asOf, "as_of"); e != nil {
		writeErr(w, e)
		return
	}
	if mode != "actual" && mode != "projected" {
		writeErr(w, badRequest("mode must be 'actual' or 'projected'", nil))
		return
	}

	if mode == "actual" {
		rows, err := s.db.Query(`
			WITH deltas AS (
			  SELECT d.account_id, SUM(d.delta_cents) AS delta_cents
			  FROM v_entry_delta d
			  JOIN account a ON a.id = d.account_id
			  WHERE d.entry_date <= ?
			    AND d.entry_date >= a.opening_date
			  GROUP BY d.account_id
			)
			SELECT
			  a.id,
			  a.name,
			  a.opening_date,
			  a.opening_balance_cents,
			  COALESCE(d.delta_cents, 0) AS delta_cents,
			  a.opening_balance_cents + COALESCE(d.delta_cents, 0) AS balance_cents,
			  a.is_liability,
			  a.is_interest_bearing,
			  a.interest_apr_bps,
			  a.interest_compound,
			  a.exclude_from_dashboard
			FROM account a
			LEFT JOIN deltas d ON d.account_id = a.id
			WHERE a.archived_at IS NULL
			ORDER BY a.name
		`, asOf)
		if err != nil {
			writeErr(w, serverError("failed to compute balances", err))
			return
		}
		defer rows.Close()
		data, err := rowsToMaps(rows)
		if err != nil {
			writeErr(w, serverError("failed to read balances", err))
			return
		}
		writeOK(w, data)
		return
	}

	if strings.TrimSpace(from) == "" {
		from = asOf
	}
	if _, e := requireDate(from, "from_date"); e != nil {
		writeErr(w, e)
		return
	}

	q := projectedBalanceQuery()
	start := projectionStartDate(from, asOf)
	rows, err := s.db.Query(q, asOf, start, asOf, asOf)
	if err != nil {
		writeErr(w, serverError("failed to compute projected balances", err))
		return
	}
	defer rows.Close()
	data, err := rowsToMaps(rows)
	if err != nil {
		writeErr(w, serverError("failed to read projected balances", err))
		return
	}
	writeOK(w, data)
}

type balancePoint struct {
	ID           int64
	Name         string
	BalanceCents int64
}

type accountMeta struct {
	ID                   int64
	Name                 string
	OpeningDate          string
	IsLiability          int64
	IsInterestBearing    int64
	InterestAprBps       int64
	InterestCompound     string
	ExcludeFromDashboard int64
}

func (s *server) activeAccountMeta() (map[int64]accountMeta, error) {
	rows, err := s.db.Query(`
		SELECT id, name, opening_date,
		       COALESCE(is_liability, 0) AS is_liability,
		       COALESCE(is_interest_bearing, 0) AS is_interest_bearing,
		       COALESCE(interest_apr_bps, 0) AS interest_apr_bps,
		       COALESCE(interest_compound, 'D') AS interest_compound,
		       COALESCE(exclude_from_dashboard, 0) AS exclude_from_dashboard
		FROM account
		WHERE archived_at IS NULL
		ORDER BY name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[int64]accountMeta)
	for rows.Next() {
		var m accountMeta
		if err := rows.Scan(&m.ID, &m.Name, &m.OpeningDate, &m.IsLiability, &m.IsInterestBearing, &m.InterestAprBps, &m.InterestCompound, &m.ExcludeFromDashboard); err != nil {
			return nil, err
		}
		out[m.ID] = m
	}
	return out, rows.Err()
}

func interestForPeriod(balanceCents int64, aprBps int64, compound string, days int) float64 {
	if days <= 0 || aprBps <= 0 {
		return 0
	}
	// APR in bps (e.g., 1899 = 18.99%). Convert to decimal annual rate.
	annual := float64(aprBps) / 10000.0

	var factor float64
	switch compound {
	case "M":
		// Approximate "monthly" compounding over fractional months.
		months := float64(days) / 30.4375
		factor = math.Pow(1.0+(annual/12.0), months) - 1.0
	default:
		// Daily compounding.
		daily := annual / 365.0
		factor = math.Pow(1.0+daily, float64(days)) - 1.0
	}
	// Sign-aware: negative balances produce negative interest deltas (debt grows).
	return float64(balanceCents) * factor
}

func interestForPeriodCents(balanceCents int64, aprBps int64, compound string, days int) int64 {
	return int64(math.Round(interestForPeriod(balanceCents, aprBps, compound, days)))
}

func (s *server) actualBalancesAsOf(asOf string) ([]balancePoint, error) {
	rows, err := s.db.Query(`
		WITH deltas AS (
		  SELECT d.account_id, SUM(d.delta_cents) AS delta_cents
		  FROM v_entry_delta d
		  JOIN account a ON a.id = d.account_id
		  WHERE d.entry_date <= ?
		    AND d.entry_date >= a.opening_date
		  GROUP BY d.account_id
		)
		SELECT
		  a.id,
		  a.name,
		  a.opening_balance_cents + COALESCE(d.delta_cents, 0) AS balance_cents
		FROM account a
		LEFT JOIN deltas d ON d.account_id = a.id
		WHERE a.archived_at IS NULL
		ORDER BY a.name
	`, asOf)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []balancePoint
	for rows.Next() {
		var p balancePoint
		if err := rows.Scan(&p.ID, &p.Name, &p.BalanceCents); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func projectionStartDate(fromDate string, asOf string) string {
	// If a projection window starts in the future, include scheduled occurrences
	// between today and the requested window so balances reflect those changes.
	today := time.Now().Format("2006-01-02")
	start := fromDate
	if today < start {
		start = today
	}
	if start > asOf {
		start = asOf
	}
	return start
}

func (s *server) projectedBalancesAsOf(fromDate string, asOf string) ([]balancePoint, error) {
	q := projectedBalanceQuery()
	start := projectionStartDate(fromDate, asOf)
	rows, err := s.db.Query(q, asOf, start, asOf, asOf)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []balancePoint
	for rows.Next() {
		var (
			id             int64
			name           string
			openingDate    string
			openingBalance int64
			delta          int64
			projected      int64
			// projectedBalanceQuery also returns account metadata columns.
			// We don't need them for the series calculation, but we must scan them.
			isLiability          any
			isInterestBearing    any
			interestAprBps       any
			interestCompound     any
			excludeFromDashboard any
		)
		if err := rows.Scan(
			&id,
			&name,
			&openingDate,
			&openingBalance,
			&delta,
			&projected,
			&isLiability,
			&isInterestBearing,
			&interestAprBps,
			&interestCompound,
			&excludeFromDashboard,
		); err != nil {
			return nil, err
		}
		out = append(out, balancePoint{ID: id, Name: name, BalanceCents: projected})
	}
	return out, rows.Err()
}

func (s *server) balancesSeries(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	from := r.URL.Query().Get("from_date")
	to := r.URL.Query().Get("to_date")
	stepDaysStr := r.URL.Query().Get("step_days")
	includeInterestStr := r.URL.Query().Get("include_interest")
	if mode == "" {
		mode = "projected"
	}
	if mode != "actual" && mode != "projected" {
		writeErr(w, badRequest("mode must be 'actual' or 'projected'", nil))
		return
	}
	if _, e := requireDate(from, "from_date"); e != nil {
		writeErr(w, e)
		return
	}
	if _, e := requireDate(to, "to_date"); e != nil {
		writeErr(w, e)
		return
	}

	stepDays := 7
	if strings.TrimSpace(stepDaysStr) != "" {
		n, err := strconv.Atoi(stepDaysStr)
		if err != nil {
			writeErr(w, badRequest("step_days must be an integer", nil))
			return
		}
		stepDays = n
	}
	if stepDays < 1 || stepDays > 366 {
		writeErr(w, badRequest("step_days must be 1..366", nil))
		return
	}

	includeInterest := false
	if strings.TrimSpace(includeInterestStr) != "" {
		s := strings.ToLower(strings.TrimSpace(includeInterestStr))
		includeInterest = s == "1" || s == "true" || s == "yes" || s == "on"
	}
	if includeInterest && mode != "projected" {
		writeErr(w, badRequest("include_interest is only supported for mode=projected", nil))
		return
	}

	fromT, err := time.Parse("2006-01-02", from)
	if err != nil {
		writeErr(w, badRequest("from_date must be YYYY-MM-DD", nil))
		return
	}
	toT, err := time.Parse("2006-01-02", to)
	if err != nil {
		writeErr(w, badRequest("to_date must be YYYY-MM-DD", nil))
		return
	}
	if toT.Before(fromT) {
		writeErr(w, badRequest("to_date must be >= from_date", nil))
		return
	}

	const maxPoints = 420
	// Compute points (inclusive).
	days := int(toT.Sub(fromT).Hours() / 24)
	points := days/stepDays + 1
	if points > maxPoints {
		writeErr(w, badRequest("requested series is too long", map[string]any{"max_points": maxPoints, "points": points}))
		return
	}

	type accountSeries struct {
		ID                   int64   `json:"id"`
		Name                 string  `json:"name"`
		IsLiability          int64   `json:"is_liability"`
		IsInterestBearing    int64   `json:"is_interest_bearing"`
		InterestAprBps       int64   `json:"interest_apr_bps"`
		InterestCompound     string  `json:"interest_compound"`
		ExcludeFromDashboard int64   `json:"exclude_from_dashboard"`
		BalanceCents         []int64 `json:"balance_cents"`
	}

	var (
		dates      []string
		totalCents []int64
		accounts   []accountSeries
		acctIndex  map[int64]int
	)

	acctIndex = make(map[int64]int)
	metaByID, err := s.activeAccountMeta()
	if err != nil {
		writeErr(w, serverError("failed to read account metadata", err))
		return
	}

	basePrev := make(map[int64]int64)
	adjPrev := make(map[int64]int64)
	interestCarry := make(map[int64]float64)
	openByID := make(map[int64]time.Time)
	var interestStart time.Time
	interestStartSet := false
	for _, m := range metaByID {
		if strings.TrimSpace(m.OpeningDate) != "" {
			if od, err := time.Parse("2006-01-02", m.OpeningDate); err == nil {
				openByID[m.ID] = od
				if includeInterest && m.IsInterestBearing == 1 {
					if !interestStartSet || od.Before(interestStart) {
						interestStart = od
						interestStartSet = true
					}
				}
			}
		}
	}
	if !interestStartSet {
		interestStart = fromT
	}

	projFromDate := from
	warmStart := fromT
	warmStepDays := stepDays
	doWarmup := false
	if includeInterest && mode == "projected" && interestStart.Before(fromT) {
		warmStart = interestStart
		doWarmup = true
		projFromDate = warmStart.Format("2006-01-02")
		warmDays := int(fromT.Sub(warmStart).Hours() / 24)
		const maxWarmPoints = 420
		if warmDays > 0 {
			points := warmDays/warmStepDays + 1
			if points > maxWarmPoints {
				warmStepDays = int(math.Ceil(float64(warmDays) / float64(maxWarmPoints-1)))
				if warmStepDays < 1 {
					warmStepDays = 1
				}
			}
		}
	}

	var prevDate time.Time
	hasPrev := false

	processPoint := func(cur time.Time, record bool) *apiErr {
		asOf := cur.Format("2006-01-02")
		var bal []balancePoint
		var err error
		if mode == "actual" {
			bal, err = s.actualBalancesAsOf(asOf)
		} else {
			bal, err = s.projectedBalancesAsOf(projFromDate, asOf)
		}
		if err != nil {
			return serverError("failed to compute balances series", err)
		}

		if len(accounts) == 0 {
			for _, p := range bal {
				acctIndex[p.ID] = len(accounts)
				m := metaByID[p.ID]
				accounts = append(accounts, accountSeries{
					ID:                   p.ID,
					Name:                 p.Name,
					IsLiability:          m.IsLiability,
					IsInterestBearing:    m.IsInterestBearing,
					InterestAprBps:       m.InterestAprBps,
					InterestCompound:     m.InterestCompound,
					ExcludeFromDashboard: m.ExcludeFromDashboard,
					BalanceCents:         make([]int64, 0, points),
				})
				basePrev[p.ID] = p.BalanceCents
				adjPrev[p.ID] = p.BalanceCents
			}
		}

		daysSincePrev := 0
		if hasPrev {
			daysSincePrev = int(cur.Sub(prevDate).Hours() / 24)
		}

		var sum int64
		for _, p := range bal {
			val := p.BalanceCents
			idx, ok := acctIndex[p.ID]
			if !ok {
				// Accounts should be stable across the series; if a new one appears, append it.
				acctIndex[p.ID] = len(accounts)
				m := metaByID[p.ID]
				accounts = append(accounts, accountSeries{ID: p.ID, Name: p.Name, IsLiability: m.IsLiability, IsInterestBearing: m.IsInterestBearing, InterestAprBps: m.InterestAprBps, InterestCompound: m.InterestCompound, ExcludeFromDashboard: m.ExcludeFromDashboard})
				idx = len(accounts) - 1
				if record {
					// backfill missing earlier points with zeros
					for i := 0; i < len(dates); i++ {
						accounts[idx].BalanceCents = append(accounts[idx].BalanceCents, 0)
					}
				}
				basePrev[p.ID] = p.BalanceCents
				adjPrev[p.ID] = p.BalanceCents
			}

			if includeInterest && hasPrev && daysSincePrev > 0 {
				m := metaByID[p.ID]
				bp := basePrev[p.ID]
				delta := p.BalanceCents - bp
				ap := adjPrev[p.ID]
				applyInterest := m.IsInterestBearing == 1 && m.InterestAprBps > 0
				if applyInterest {
					if od, ok := openByID[p.ID]; ok && cur.Before(od) {
						applyInterest = false
					}
				}
				if applyInterest {
					interest := interestForPeriod(ap, m.InterestAprBps, m.InterestCompound, daysSincePrev)
					carry := interestCarry[p.ID] + interest
					interestCents := int64(math.Trunc(carry))
					interestCarry[p.ID] = carry - float64(interestCents)
					val = ap + delta + interestCents
				} else {
					val = ap + delta
				}
				basePrev[p.ID] = p.BalanceCents
				adjPrev[p.ID] = val
			} else if includeInterest && !hasPrev {
				basePrev[p.ID] = p.BalanceCents
				adjPrev[p.ID] = p.BalanceCents
			}

			sum += val
			if record {
				accounts[idx].BalanceCents = append(accounts[idx].BalanceCents, val)
			}
		}
		if record {
			dates = append(dates, asOf)
			totalCents = append(totalCents, sum)
			// Ensure every account series has a point for this date.
			for i := range accounts {
				if len(accounts[i].BalanceCents) < len(dates) {
					accounts[i].BalanceCents = append(accounts[i].BalanceCents, 0)
				}
			}
		}
		prevDate = cur
		hasPrev = true
		return nil
	}

	if doWarmup {
		for cur := warmStart; cur.Before(fromT); cur = cur.AddDate(0, 0, warmStepDays) {
			if e := processPoint(cur, false); e != nil {
				writeErr(w, e)
				return
			}
		}
	}

	for cur := fromT; !cur.After(toT); cur = cur.AddDate(0, 0, stepDays) {
		if e := processPoint(cur, true); e != nil {
			writeErr(w, e)
			return
		}
	}

	writeOK(w, map[string]any{
		"mode":        mode,
		"from_date":   from,
		"to_date":     to,
		"step_days":   stepDays,
		"dates":       dates,
		"total_cents": totalCents,
		"accounts":    accounts,
	})
}

// --- Schedule payload parsing ---

type schedulePayload struct {
	Name          string  `json:"name"`
	Kind          string  `json:"kind"`
	AmountCents   int64   `json:"amount_cents"`
	SrcAccountID  *int64  `json:"src_account_id"`
	DestAccountID *int64  `json:"dest_account_id"`
	StartDate     string  `json:"start_date"`
	EndDate       *string `json:"end_date"`
	Freq          string  `json:"freq"`
	Interval      int64   `json:"interval"`
	ByMonthDay    *int64  `json:"bymonthday"`
	ByWeekday     *int64  `json:"byweekday"`
	Description   *string `json:"description"`
	IsActive      *int64  `json:"is_active"`
}

func parseSchedulePayload(r *http.Request) (*schedulePayload, *apiErr) {
	var p schedulePayload
	if e := readJSON(r, &p); e != nil {
		return nil, e
	}
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return nil, badRequest("name is required", nil)
	}
	if p.Kind != "I" && p.Kind != "E" && p.Kind != "T" {
		return nil, badRequest("kind must be one of I, E, T", nil)
	}
	if p.Freq != "D" && p.Freq != "W" && p.Freq != "M" && p.Freq != "Y" {
		return nil, badRequest("freq must be one of D, W, M, Y", nil)
	}
	if p.AmountCents <= 0 {
		return nil, badRequest("amount_cents must be > 0", nil)
	}
	if _, e := requireDate(p.StartDate, "start_date"); e != nil {
		return nil, e
	}
	end, e := optionalDate(p.EndDate, "end_date")
	if e != nil {
		return nil, e
	}
	p.EndDate = end
	if p.Interval < 1 {
		p.Interval = 1
	}
	if p.ByMonthDay != nil {
		if *p.ByMonthDay < 1 || *p.ByMonthDay > 31 {
			return nil, badRequest("bymonthday must be 1..31", nil)
		}
	}
	if p.ByWeekday != nil {
		if *p.ByWeekday < 0 || *p.ByWeekday > 6 {
			return nil, badRequest("byweekday must be 0..6", nil)
		}
	}
	if p.IsActive == nil {
		v := int64(1)
		p.IsActive = &v
	} else if *p.IsActive != 0 {
		v := int64(1)
		p.IsActive = &v
	} else {
		v := int64(0)
		p.IsActive = &v
	}

	src := p.SrcAccountID
	dest := p.DestAccountID
	if p.Kind == "I" {
		if dest == nil || src != nil {
			return nil, badRequest("Income schedules require dest_account_id and must not set src_account_id", nil)
		}
	}
	if p.Kind == "E" {
		if src == nil || dest != nil {
			return nil, badRequest("Expense schedules require src_account_id and must not set dest_account_id", nil)
		}
	}
	if p.Kind == "T" {
		if src == nil || dest == nil || *src == *dest {
			return nil, badRequest("Transfer schedules require distinct src_account_id and dest_account_id", nil)
		}
	}

	return &p, nil
}
