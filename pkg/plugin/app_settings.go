package plugin

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type persistedAppSettings struct {
	JSONData       []byte
	SecureJSONData map[string]string
	UpdatedAt      time.Time
}

func (a *App) loadPersistedAppSettings(ctx context.Context, orgID int64) (*persistedAppSettings, error) {
	if a.db == nil {
		return nil, errors.New("database not initialized")
	}
	row := a.db.QueryRowContext(ctx, `SELECT json_data, secure_json_data, updated_at FROM app_settings WHERE org_id = ?`, orgID)
	var jsonData string
	var secureJSON sql.NullString
	var updatedStr string
	if err := row.Scan(&jsonData, &secureJSON, &updatedStr); err != nil {
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

	return settings, nil
}

func (a *App) savePersistedAppSettings(ctx context.Context, orgID int64, settings backend.AppInstanceSettings) error {
	if a.db == nil {
		return errors.New("database not initialized")
	}
	updated := settings.Updated
	if updated.IsZero() {
		updated = time.Now().UTC()
	}

	var secureJSON interface{}
	if len(settings.DecryptedSecureJSONData) > 0 {
		encoded, err := json.Marshal(settings.DecryptedSecureJSONData)
		if err != nil {
			return fmt.Errorf("encode secure settings: %w", err)
		}
		secureJSON = string(encoded)
	}

	_, err := a.db.ExecContext(
		ctx,
		`INSERT INTO app_settings (org_id, json_data, secure_json_data, updated_at)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(org_id) DO UPDATE SET
                        json_data = excluded.json_data,
                        secure_json_data = excluded.secure_json_data,
                        updated_at = excluded.updated_at`,
		orgID,
		string(settings.JSONData),
		secureJSON,
		updated.Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("persist app settings: %w", err)
	}
	return nil
}

func (a *App) persistAppInstanceSettings(ctx context.Context, orgID int64, settings backend.AppInstanceSettings, existing *persistedAppSettings, preferPersisted bool) error {
	if a.db == nil || orgID == 0 {
		return nil
	}

	if existing != nil {
		hasSecrets := len(settings.DecryptedSecureJSONData) > 0
		if preferPersisted && !hasSecrets {
			// Nothing new to store—keep the existing copy.
			return nil
		}

		if !hasSecrets && jsonDataMatches(existing.JSONData, settings.JSONData) {
			// Incoming JSON matches what we already have on disk, so avoid a no-op write.
			return nil
		}
	}

	merged := backend.AppInstanceSettings{
		JSONData:                append([]byte(nil), settings.JSONData...),
		DecryptedSecureJSONData: copyStringMap(settings.DecryptedSecureJSONData),
		Updated:                 settings.Updated,
		APIVersion:              settings.APIVersion,
	}

	if existing != nil {
		if preferPersisted {
			if len(existing.JSONData) > 0 {
				merged.JSONData = append([]byte(nil), existing.JSONData...)
			}
		} else if len(merged.JSONData) == 0 && len(existing.JSONData) > 0 {
			merged.JSONData = append([]byte(nil), existing.JSONData...)
		}

		if len(existing.SecureJSONData) > 0 {
			if len(merged.DecryptedSecureJSONData) == 0 {
				merged.DecryptedSecureJSONData = make(map[string]string, len(existing.SecureJSONData))
				for k, v := range existing.SecureJSONData {
					merged.DecryptedSecureJSONData[k] = v
				}
			} else {
				combined := make(map[string]string, len(existing.SecureJSONData)+len(merged.DecryptedSecureJSONData))
				for k, v := range existing.SecureJSONData {
					combined[k] = v
				}
				for k, v := range merged.DecryptedSecureJSONData {
					combined[k] = v
				}
				merged.DecryptedSecureJSONData = combined
			}
		}
	}

	return a.savePersistedAppSettings(ctx, orgID, merged)
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

func jsonDataMatches(existing, incoming []byte) bool {
	existing = bytes.TrimSpace(existing)
	incoming = bytes.TrimSpace(incoming)

	if len(existing) == 0 && len(incoming) == 0 {
		return true
	}
	if len(existing) == 0 || len(incoming) == 0 {
		return false
	}

	var canonicalExisting, canonicalIncoming bytes.Buffer
	if err := json.Compact(&canonicalExisting, existing); err != nil {
		return false
	}
	if err := json.Compact(&canonicalIncoming, incoming); err != nil {
		return false
	}

	return bytes.Equal(canonicalExisting.Bytes(), canonicalIncoming.Bytes())
}

func shouldPreferPersistedSettings(settings backend.AppInstanceSettings, persisted *persistedAppSettings) bool {
	if persisted == nil {
		return false
	}
	if persisted.UpdatedAt.IsZero() {
		return false
	}
	if settings.Updated.IsZero() {
		return true
	}
	// Prefer the persisted settings whenever they are at least as recent as the
	// payload provided by Grafana. This covers the Grafana restart case where the
	// runtime provides default settings with the same Updated timestamp that was
	// already stored in SQLite. In that scenario we should keep the previously
	// persisted values instead of overwriting them with defaults.
	return !persisted.UpdatedAt.Before(settings.Updated)
}

func mergeConfigWithPersisted(current Config, persisted Config, preferPersisted bool) Config {
	if preferPersisted {
		return persisted
	}

	merged := current
	if merged.APIURL == "" {
		merged.APIURL = persisted.APIURL
	}
	if merged.APIKey == "" {
		merged.APIKey = persisted.APIKey
	}
	if merged.Storage.Bucket == "" {
		merged.Storage.Bucket = persisted.Storage.Bucket
	}
	if merged.Storage.Prefix == "" {
		merged.Storage.Prefix = persisted.Storage.Prefix
	}
	if len(merged.Storage.ServiceAccountJSON) == 0 && len(persisted.Storage.ServiceAccountJSON) > 0 {
		merged.Storage.ServiceAccountJSON = persisted.Storage.ServiceAccountJSON
	}
	if merged.Storage.MaxUploadSizeMB == defaultMaxUploadSizeMB && persisted.Storage.MaxUploadSizeMB != 0 && persisted.Storage.MaxUploadSizeMB != defaultMaxUploadSizeMB {
		merged.Storage.MaxUploadSizeMB = persisted.Storage.MaxUploadSizeMB
		merged.Storage.MaxUploadSizeBytes = persisted.Storage.MaxUploadSizeBytes
	}
	if merged.Storage.MaxUploadSizeBytes == 0 {
		merged.Storage.MaxUploadSizeBytes = merged.Storage.MaxUploadSizeMB * bytesInMegabyte
	}
	return merged
}
