package plugin

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type persistedAppSettings struct {
	JSONData       []byte
	SecureJSONData map[string]string
	UpdatedAt      time.Time

	ProvisionedJSONData       []byte
	ProvisionedSecureJSONData map[string]string
	ProvisionedUpdatedAt      time.Time
}

func (a *App) loadPersistedAppSettings(ctx context.Context, orgID int64) (*persistedAppSettings, error) {
	if a.db == nil {
		return nil, errors.New("database not initialized")
	}
	row := a.db.QueryRowContext(ctx, `SELECT json_data, secure_json_data, updated_at, provisioned_json_data, provisioned_secure_json_data, provisioned_updated_at FROM app_settings WHERE org_id = ?`, orgID)
	var jsonData string
	var secureJSON sql.NullString
	var updatedStr string
	var provisionedJSON sql.NullString
	var provisionedSecure sql.NullString
	var provisionedUpdated sql.NullString
	if err := row.Scan(&jsonData, &secureJSON, &updatedStr, &provisionedJSON, &provisionedSecure, &provisionedUpdated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query app settings: %w", err)
	}

	settings := &persistedAppSettings{JSONData: []byte(jsonData)}
	if trimmed := strings.TrimSpace(updatedStr); trimmed != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
			settings.UpdatedAt = parsed
		} else if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
			settings.UpdatedAt = parsed
		} else {
			return nil, fmt.Errorf("parse settings timestamp: %w", err)
		}
	}

	if secureJSON.Valid && strings.TrimSpace(secureJSON.String) != "" {
		var secure map[string]string
		if err := json.Unmarshal([]byte(secureJSON.String), &secure); err != nil {
			return nil, fmt.Errorf("decode secure settings: %w", err)
		}
		settings.SecureJSONData = secure
	}

	if provisionedJSON.Valid && strings.TrimSpace(provisionedJSON.String) != "" {
		settings.ProvisionedJSONData = []byte(provisionedJSON.String)
	}
	if provisionedSecure.Valid && strings.TrimSpace(provisionedSecure.String) != "" {
		var secure map[string]string
		if err := json.Unmarshal([]byte(provisionedSecure.String), &secure); err != nil {
			return nil, fmt.Errorf("decode provisioned secure settings: %w", err)
		}
		settings.ProvisionedSecureJSONData = secure
	}
	if trimmed := strings.TrimSpace(provisionedUpdated.String); trimmed != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
			settings.ProvisionedUpdatedAt = parsed
		} else if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
			settings.ProvisionedUpdatedAt = parsed
		} else {
			return nil, fmt.Errorf("parse provisioned settings timestamp: %w", err)
		}
	}

	return settings, nil
}

func (a *App) savePersistedAppSettings(ctx context.Context, orgID int64, settings backend.AppInstanceSettings, existing *persistedAppSettings) error {
	if a.db == nil {
		return errors.New("database not initialized")
	}
	updated := settings.Updated
	if updated.IsZero() {
		updated = time.Now().UTC()
	}

	canonicalJSON, err := canonicalizeJSON(settings.JSONData)
	if err != nil {
		return fmt.Errorf("canonicalize settings json: %w", err)
	}
	secureJSONStr, err := encodeStringMap(settings.DecryptedSecureJSONData)
	if err != nil {
		return fmt.Errorf("encode secure settings: %w", err)
	}

	provisionedJSON := []byte(nil)
	provisionedSecure := map[string]string(nil)
	provisionedUpdated := time.Time{}
	if existing != nil {
		provisionedJSON = append([]byte(nil), existing.ProvisionedJSONData...)
		provisionedSecure = copyStringMap(existing.ProvisionedSecureJSONData)
		provisionedUpdated = existing.ProvisionedUpdatedAt
	}

	if len(provisionedJSON) == 0 && len(provisionedSecure) == 0 {
		if existing != nil {
			provisionedJSON = append([]byte(nil), existing.JSONData...)
			provisionedSecure = copyStringMap(existing.SecureJSONData)
			provisionedUpdated = existing.UpdatedAt
		} else {
			provisionedJSON = append([]byte(nil), canonicalJSON...)
			provisionedSecure = copyStringMap(settings.DecryptedSecureJSONData)
			provisionedUpdated = updated
		}
	}

	provisionedJSONStr := nullableStringFromBytes(provisionedJSON)
	provisionedSecureStr, err := encodeStringMap(provisionedSecure)
	if err != nil {
		return fmt.Errorf("encode provisioned secure settings: %w", err)
	}
	var provisionedUpdatedStr interface{}
	if !provisionedUpdated.IsZero() {
		provisionedUpdatedStr = provisionedUpdated.Format(time.RFC3339Nano)
	}

	var secureJSON interface{}
	if secureJSONStr != "" {
		secureJSON = secureJSONStr
	}

	var provisionedSecureJSON interface{}
	if provisionedSecureStr != "" {
		provisionedSecureJSON = provisionedSecureStr
	}

	_, err = a.db.ExecContext(
		ctx,
		`INSERT INTO app_settings (org_id, json_data, secure_json_data, updated_at, provisioned_json_data, provisioned_secure_json_data, provisioned_updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(org_id) DO UPDATE SET
                        json_data = excluded.json_data,
                        secure_json_data = excluded.secure_json_data,
                        updated_at = excluded.updated_at,
                        provisioned_json_data = excluded.provisioned_json_data,
                        provisioned_secure_json_data = excluded.provisioned_secure_json_data,
                        provisioned_updated_at = excluded.provisioned_updated_at`,
		orgID,
		string(canonicalJSON),
		secureJSON,
		updated.Format(time.RFC3339Nano),
		provisionedJSONStr,
		provisionedSecureJSON,
		provisionedUpdatedStr,
	)
	if err != nil {
		return fmt.Errorf("persist app settings: %w", err)
	}
	return nil
}

func mergeAppInstanceSettings(settings backend.AppInstanceSettings, persisted *persistedAppSettings) backend.AppInstanceSettings {
	merged := backend.AppInstanceSettings{
		JSONData:                append([]byte(nil), settings.JSONData...),
		DecryptedSecureJSONData: copyStringMap(settings.DecryptedSecureJSONData),
		Updated:                 settings.Updated,
		APIVersion:              settings.APIVersion,
	}

	if persisted == nil {
		return merged
	}

	if len(merged.JSONData) == 0 && len(persisted.JSONData) > 0 {
		merged.JSONData = append([]byte(nil), persisted.JSONData...)
	}

	if len(persisted.SecureJSONData) > 0 {
		if len(merged.DecryptedSecureJSONData) == 0 {
			merged.DecryptedSecureJSONData = copyStringMap(persisted.SecureJSONData)
		} else if len(persisted.ProvisionedSecureJSONData) > 0 &&
			mapsEqual(merged.DecryptedSecureJSONData, persisted.ProvisionedSecureJSONData) &&
			!mapsEqual(persisted.SecureJSONData, persisted.ProvisionedSecureJSONData) {
			merged.DecryptedSecureJSONData = copyStringMap(persisted.SecureJSONData)
		} else {
			for k, v := range persisted.SecureJSONData {
				if val, exists := merged.DecryptedSecureJSONData[k]; !exists || strings.TrimSpace(val) == "" {
					merged.DecryptedSecureJSONData[k] = v
				}
			}
		}
	}

	return merged
}

func persistedToAppInstanceSettings(p *persistedAppSettings, apiVersion string) backend.AppInstanceSettings {
	if p == nil {
		return backend.AppInstanceSettings{APIVersion: apiVersion}
	}
	return backend.AppInstanceSettings{
		JSONData:                append([]byte(nil), p.JSONData...),
		DecryptedSecureJSONData: copyStringMap(p.SecureJSONData),
		Updated:                 p.UpdatedAt,
		APIVersion:              apiVersion,
	}
}

func hasNonEmptySettings(settings backend.AppInstanceSettings) bool {
	if len(settings.JSONData) > 0 {
		return true
	}
	return len(settings.DecryptedSecureJSONData) > 0
}

func shouldPersistUpdate(settings backend.AppInstanceSettings, persisted *persistedAppSettings) bool {
	if persisted == nil {
		return hasNonEmptySettings(settings)
	}
	if !hasNonEmptySettings(settings) {
		return false
	}
	if isProvisionedFallback(settings, persisted) {
		return false
	}
	if settings.Updated.IsZero() {
		return false
	}
	if persisted.UpdatedAt.IsZero() {
		return true
	}
	if !settings.Updated.After(persisted.UpdatedAt) {
		return false
	}

	if jsonEqual(settings.JSONData, persisted.JSONData) && mapsEqual(settings.DecryptedSecureJSONData, persisted.SecureJSONData) {
		return false
	}

	return true
}

func copyStringMap(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	dst := make(map[string]string, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func isProvisionedFallback(settings backend.AppInstanceSettings, persisted *persistedAppSettings) bool {
	if persisted == nil {
		return false
	}
	if len(persisted.ProvisionedJSONData) == 0 && len(persisted.ProvisionedSecureJSONData) == 0 {
		return false
	}
	if !jsonEqual(settings.JSONData, persisted.ProvisionedJSONData) {
		return false
	}
	if !mapsEqual(settings.DecryptedSecureJSONData, persisted.ProvisionedSecureJSONData) {
		return false
	}
	return true
}

func jsonEqual(a, b []byte) bool {
	if len(bytes.TrimSpace(a)) == 0 && len(bytes.TrimSpace(b)) == 0 {
		return true
	}

	var va interface{}
	if err := json.Unmarshal(a, &va); err != nil {
		return bytes.Equal(bytes.TrimSpace(a), bytes.TrimSpace(b))
	}

	var vb interface{}
	if err := json.Unmarshal(b, &vb); err != nil {
		return false
	}

	return reflect.DeepEqual(va, vb)
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func canonicalizeJSON(data []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return []byte{}, nil
	}
	var v interface{}
	if err := json.Unmarshal(trimmed, &v); err != nil {
		return trimmed, nil
	}
	encoded, err := json.Marshal(v)
	if err != nil {
		return trimmed, err
	}
	return encoded, nil
}

func encodeStringMap(values map[string]string) (string, error) {
	if len(values) == 0 {
		return "", nil
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func nullableStringFromBytes(data []byte) interface{} {
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	return string(data)
}
