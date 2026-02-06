package budgie

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var isoDateRE = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

type apiErr struct {
	Status  int
	Message string
	Details any
}

func (e *apiErr) Error() string { return e.Message }

func badRequest(msg string, details any) *apiErr {
	return &apiErr{Status: 400, Message: msg, Details: details}
}
func unauthorized(msg string) *apiErr { return &apiErr{Status: 401, Message: msg} }
func forbidden(msg string) *apiErr    { return &apiErr{Status: 403, Message: msg} }
func notFound(msg string) *apiErr     { return &apiErr{Status: 404, Message: msg} }
func serverError(msg string, err error) *apiErr {
	log.Printf("ERROR: %s: %v", msg, err)
	return &apiErr{Status: 500, Message: msg}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeOK(w http.ResponseWriter, data any) {
	writeJSON(w, 200, map[string]any{"ok": true, "data": data})
}

func writeErr(w http.ResponseWriter, err *apiErr) {
	payload := map[string]any{"ok": false, "error": err.Message}
	if err.Details != nil {
		payload["details"] = err.Details
	}
	writeJSON(w, err.Status, payload)
}

func readJSON(r *http.Request, dst any) *apiErr {
	b, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return badRequest("could not read body", nil)
	}
	if len(b) == 0 {
		b = []byte(`{}`)
	}
	if err := json.Unmarshal(b, dst); err != nil {
		return badRequest("invalid JSON", map[string]any{"error": err.Error()})
	}
	return nil
}

func requireDate(v string, field string) (string, *apiErr) {
	if !isoDateRE.MatchString(v) {
		return "", badRequest(fmt.Sprintf("%s must be an ISO date YYYY-MM-DD", field), nil)
	}
	if _, err := time.Parse("2006-01-02", v); err != nil {
		return "", badRequest(fmt.Sprintf("%s is not a valid calendar date", field), nil)
	}
	return v, nil
}

func optionalDate(v *string, field string) (*string, *apiErr) {
	if v == nil {
		return nil, nil
	}
	if strings.TrimSpace(*v) == "" {
		return nil, nil
	}
	d, e := requireDate(*v, field)
	if e != nil {
		return nil, e
	}
	return &d, nil
}

func parseIDFromPath(prefix string, path string) (int64, bool) {
	if !strings.HasPrefix(path, prefix) {
		return 0, false
	}
	s := strings.TrimPrefix(path, prefix)
	s = strings.Trim(s, "/")
	if s == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func rowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0)
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			switch v := vals[i].(type) {
			case []byte:
				m[c] = string(v)
			default:
				m[c] = v
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func mapFromCols(cols []string, vals []any) map[string]any {
	m := make(map[string]any, len(cols))
	for i, c := range cols {
		switch v := vals[i].(type) {
		case []byte:
			m[c] = string(v)
		default:
			m[c] = v
		}
	}
	return m
}

func mustTableCols(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := []string{}
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt any
		var pk int
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return cols, rows.Err()
}

func scanRowToMap(db *sql.DB, table string, id int64) (map[string]any, *apiErr) {
	cols, err := mustTableCols(db, table)
	if err != nil {
		return nil, serverError("failed to introspect table", err)
	}
	q := "SELECT " + strings.Join(cols, ",") + " FROM " + table + " WHERE id = ?"
	row := db.QueryRow(q, id)
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := row.Scan(ptrs...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, notFound(table + " not found")
		}
		return nil, serverError("failed to read row", err)
	}
	return mapFromCols(cols, vals), nil
}
