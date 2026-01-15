package budgie

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

func dashboardOwnerKey(r *http.Request) string {
	user := userFromContext(r.Context())
	if user == nil {
		return "anon"
	}
	return fmt.Sprintf("user:%d", user.ID)
}

func (s *server) dashboardLayout(w http.ResponseWriter, r *http.Request) {
	ownerKey := dashboardOwnerKey(r)

	switch r.Method {
	case http.MethodGet:
		var raw sql.NullString
		err := s.db.QueryRow(`SELECT layout_json FROM dashboard_layout WHERE owner_key = ?`, ownerKey).Scan(&raw)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeOK(w, map[string]any{"layout": nil})
				return
			}
			writeErr(w, serverError("failed to load layout", err))
			return
		}
		if !raw.Valid || raw.String == "" || !json.Valid([]byte(raw.String)) {
			writeOK(w, map[string]any{"layout": nil})
			return
		}
		writeOK(w, map[string]any{"layout": json.RawMessage(raw.String)})
	case http.MethodPut:
		var body struct {
			Layout json.RawMessage `json:"layout"`
		}
		if e := readJSON(r, &body); e != nil {
			writeErr(w, e)
			return
		}
		if len(body.Layout) == 0 || !json.Valid(body.Layout) {
			writeErr(w, badRequest("layout must be valid JSON", nil))
			return
		}
		_, err := s.db.Exec(`
			INSERT INTO dashboard_layout (owner_key, layout_json, updated_at)
			VALUES (?, ?, datetime('now'))
			ON CONFLICT(owner_key)
			DO UPDATE SET layout_json = excluded.layout_json, updated_at = datetime('now')
		`, ownerKey, string(body.Layout))
		if err != nil {
			writeErr(w, serverError("failed to save layout", err))
			return
		}
		writeOK(w, map[string]any{"saved": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
