package plugin

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

func getOrgFromRequest(inReq *http.Request) (int64, error) {
	token := inReq.Header.Get("X-Grafana-Id")
	if token == "" {
		return 0, fmt.Errorf("missing X-Grafana-Id header")
	}
	return orgIDFromGrafanaJWT(token)
}

func orgIDFromGrafanaJWT(jwt string) (int64, error) {
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		return 0, fmt.Errorf("invalid X-Grafana-Id format")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		payload, err = base64.URLEncoding.DecodeString(padBase64(parts[1]))
		if err != nil {
			return 0, fmt.Errorf("failed to decode JWT payload: %w", err)
		}
	}

	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return 0, fmt.Errorf("failed to unmarshal JWT claims: %w", err)
	}

	if v, ok := claims["aud"]; ok {
		switch t := v.(type) {
		case string:
			if strings.HasPrefix(t, "org:") {
				return strconv.ParseInt(strings.TrimPrefix(t, "org:"), 10, 64)
			}
		case []interface{}:
			for _, it := range t {
				if s, ok := it.(string); ok && strings.HasPrefix(s, "org:") {
					return strconv.ParseInt(strings.TrimPrefix(s, "org:"), 10, 64)
				}
			}
		}
	}

	if ns, ok := claims["namespace"].(string); ok && strings.HasPrefix(ns, "org-") {
		return strconv.ParseInt(strings.TrimPrefix(ns, "org-"), 10, 64)
	}

	return 0, fmt.Errorf("org not found in Grafana token claims")
}

func padBase64(s string) string {
	switch len(s) % 4 {
	case 2:
		return s + "=="
	case 3:
		return s + "="
	case 1:
		return s + "==="
	default:
		return s
	}
}

// sqlNullString is used to avoid importing database/sql across many places.
type sqlNullString struct {
	String string
	Valid  bool
}

func (ns *sqlNullString) Scan(src interface{}) error {
	if src == nil {
		ns.String, ns.Valid = "", false
		return nil
	}
	switch v := src.(type) {
	case string:
		ns.String = v
		ns.Valid = true
	case []byte:
		ns.String = string(v)
		ns.Valid = true
	default:
		ns.String = fmt.Sprintf("%v", v)
		ns.Valid = true
	}
	return nil
}
