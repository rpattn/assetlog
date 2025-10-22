package plugin

import (
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

func (a *App) persistAppInstanceSettings(ctx context.Context, orgID int64, settings backend.AppInstanceSettings, existing *persistedAppSettings) error {
	if a.db == nil || orgID == 0 {
		return nil
	}
	if existing != nil {
		// Only overwrite existing settings when Grafana indicates an update or when new secure data is provided.
		if len(settings.DecryptedSecureJSONData) == 0 {
			if settings.Updated.IsZero() || !settings.Updated.After(existing.UpdatedAt) {
				return nil
			}
		}
	}
	return a.savePersistedAppSettings(ctx, orgID, settings)
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
	return persisted.UpdatedAt.After(settings.Updated)
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
