package plugin

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestNewAppPersistsSettingsPerOrg(t *testing.T) {
	t.Setenv("SQLITE_PATH", filepath.Join(t.TempDir(), "assets.db"))
	t.Setenv(envForceLocalStorage, "1")

	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: 99})
	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://example.com","bucketName":"bucket","objectPrefix":"prefix/","maxUploadSizeMb":64}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "secret-key",
			"gcsServiceAccount": "{}",
		},
		Updated: time.Now().UTC(),
	}

	inst, err := NewApp(ctx, settings)
	if err != nil {
		t.Fatalf("NewApp returned error: %v", err)
	}
	app := inst.(*App)
	defer app.Dispose()

	persisted, err := app.loadPersistedAppSettings(context.Background(), 99)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings returned error: %v", err)
	}
	if persisted == nil {
		t.Fatalf("expected persisted settings to be stored")
	}
	if string(persisted.JSONData) == "" {
		t.Fatalf("expected json data to be stored")
	}
	if persisted.SecureJSONData["apiKey"] != "secret-key" {
		t.Fatalf("expected api key to be persisted")
	}
}

func TestNewAppUsesPersistedSettingsWhenGrafanaResets(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	t.Setenv("SQLITE_PATH", dbPath)
	t.Setenv(envForceLocalStorage, "1")

	orgID := int64(7)
	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})
	initialSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://api.initial","bucketName":"persisted-bucket","objectPrefix":"org7/","maxUploadSizeMb":32}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "initial-key",
			"gcsServiceAccount": `{"client_email":"test@example.com","private_key":"-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEAtestkey\n-----END PRIVATE KEY-----\n"}`,
		},
		Updated: time.Now().UTC(),
	}

	inst, err := NewApp(ctx, initialSettings)
	if err != nil {
		t.Fatalf("NewApp returned error: %v", err)
	}
	app := inst.(*App)
	app.Dispose()

	// Simulate Grafana restarting the plugin with default/empty settings.
	resetCtx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})
	resetSettings := backend.AppInstanceSettings{}

	inst2, err := NewApp(resetCtx, resetSettings)
	if err != nil {
		t.Fatalf("NewApp after reset returned error: %v", err)
	}
	app2 := inst2.(*App)
	defer app2.Dispose()

	if app2.config.Storage.Bucket != "persisted-bucket" {
		t.Fatalf("expected bucket from persisted settings, got %q", app2.config.Storage.Bucket)
	}
	if len(app2.config.Storage.ServiceAccountJSON) == 0 {
		t.Fatalf("expected service account to be restored from persisted settings")
	}
	if app2.config.APIKey != "initial-key" {
		t.Fatalf("expected api key to be restored from persisted settings")
	}
}

func TestNewAppHandlesStorageInitErrorsGracefully(t *testing.T) {
	t.Setenv("SQLITE_PATH", filepath.Join(t.TempDir(), "assets.db"))
	// Ensure local storage override is disabled for this test.
	t.Setenv(envForceLocalStorage, "")

	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: 11})
	// Missing client_email should trigger an initialization error.
	serviceAccount := `{"private_key":"-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n"}`
	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"bucketName":"broken-bucket"}`),
		DecryptedSecureJSONData: map[string]string{
			"gcsServiceAccount": serviceAccount,
		},
	}

	inst, err := NewApp(ctx, settings)
	if err != nil {
		t.Fatalf("NewApp should not fail when storage init errors: %v", err)
	}
	app := inst.(*App)
	defer app.Dispose()

	if app.storageConfigured() {
		t.Fatalf("storage should not be configured when initialization fails")
	}
	if app.storageInitErr == nil {
		t.Fatalf("expected storage initialization error to be captured")
	}

	res, err := app.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
	if err != nil {
		t.Fatalf("CheckHealth returned error: %v", err)
	}
	if res.Status != backend.HealthStatusError {
		t.Fatalf("expected health status error, got %v", res.Status)
	}
	if !strings.Contains(res.Message, "storage initialization failed") {
		t.Fatalf("expected health message to mention storage failure, got %q", res.Message)
	}
}

func TestPersistedSettingsRetainSecretsOnPartialUpdates(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	t.Setenv("SQLITE_PATH", dbPath)
	t.Setenv(envForceLocalStorage, "1")

	orgID := int64(42)
	baseTime := time.Now().UTC().Add(-time.Hour)
	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})

	initialSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://initial","bucketName":"initial-bucket","objectPrefix":"team/","maxUploadSizeMb":16}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "initial-api-key",
			"gcsServiceAccount": `{"client_email":"initial@example.com","private_key":"-----BEGIN PRIVATE KEY-----\nXYZ\n-----END PRIVATE KEY-----\n"}`,
		},
		Updated: baseTime,
	}

	inst, err := NewApp(ctx, initialSettings)
	if err != nil {
		t.Fatalf("NewApp returned error: %v", err)
	}
	app := inst.(*App)
	app.Dispose()

	// Simulate updating only non-secret fields from Grafana. Grafana bumps the Updated timestamp
	// but omits previously configured secrets when they are left untouched in the UI.
	updatedSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://updated","bucketName":"updated-bucket","objectPrefix":"team/",` +
			`"maxUploadSizeMb":32}`),
		Updated: baseTime.Add(time.Minute),
	}

	inst2, err := NewApp(ctx, updatedSettings)
	if err != nil {
		t.Fatalf("NewApp after update returned error: %v", err)
	}
	app2 := inst2.(*App)
	defer app2.Dispose()

	// Secrets should be preserved while JSON values reflect the latest update.
	if app2.config.Storage.Bucket != "updated-bucket" {
		t.Fatalf("expected bucket to be updated, got %q", app2.config.Storage.Bucket)
	}
	if string(app2.config.Storage.ServiceAccountJSON) == "" {
		t.Fatalf("expected service account JSON to persist across updates")
	}
	if app2.config.APIKey != "initial-api-key" {
		t.Fatalf("expected API key to persist across updates, got %q", app2.config.APIKey)
	}

	persisted, err := app2.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings returned error: %v", err)
	}
	if persisted == nil {
		t.Fatalf("expected persisted settings to exist")
	}
	if persisted.SecureJSONData["gcsServiceAccount"] == "" {
		t.Fatalf("expected stored service account JSON to remain after partial update")
	}
	if !strings.Contains(string(persisted.JSONData), "updated-bucket") {
		t.Fatalf("expected persisted JSON to contain updated bucket, got %s", persisted.JSONData)
	}
}

func TestPersistedSettingsNotOverwrittenWhenGrafanaProvidesDefaults(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	t.Setenv("SQLITE_PATH", dbPath)
	t.Setenv(envForceLocalStorage, "1")

	orgID := int64(501)
	baseTime := time.Now().UTC().Add(-2 * time.Hour)
	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})

	initialSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://persisted","bucketName":"persisted-bucket","objectPrefix":"org/","maxUploadSizeMb":48}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "persisted-api-key",
			"gcsServiceAccount": `{"client_email":"persisted@example.com","private_key":"-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n"}`,
		},
		Updated: baseTime,
	}

	inst, err := NewApp(ctx, initialSettings)
	if err != nil {
		t.Fatalf("NewApp returned error: %v", err)
	}
	app := inst.(*App)
	app.Dispose()

	// Grafana restarts the plugin and supplies defaults from app.yaml. These defaults
	// often have the same Updated timestamp that was previously stored, so the plugin
	// must not overwrite the persisted settings when that happens.
	defaultSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"","bucketName":"","objectPrefix":"","maxUploadSizeMb":25}`),
		Updated:  baseTime,
	}

	inst2, err := NewApp(ctx, defaultSettings)
	if err != nil {
		t.Fatalf("NewApp with defaults returned error: %v", err)
	}
	app2 := inst2.(*App)
	defer app2.Dispose()

	if app2.config.Storage.Bucket != "persisted-bucket" {
		t.Fatalf("expected bucket to remain persisted, got %q", app2.config.Storage.Bucket)
	}
	if app2.config.APIKey != "persisted-api-key" {
		t.Fatalf("expected API key to remain persisted, got %q", app2.config.APIKey)
	}

	persisted, err := app2.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings returned error: %v", err)
	}
	if persisted == nil {
		t.Fatalf("expected persisted settings to exist")
	}
	if !strings.Contains(string(persisted.JSONData), "persisted-bucket") {
		t.Fatalf("expected persisted JSON to keep original bucket, got %s", persisted.JSONData)
	}
	if persisted.SecureJSONData["gcsServiceAccount"] == "" {
		t.Fatalf("expected persisted secure JSON to remain populated")
	}
}

func TestPersistedSettingsRetainedWhenDefaultsIncludeSecrets(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	t.Setenv("SQLITE_PATH", dbPath)
	t.Setenv(envForceLocalStorage, "1")

	orgID := int64(812)
	baseTime := time.Now().UTC().Add(-time.Hour)
	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})

	initialSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://persisted","bucketName":"persisted-bucket","objectPrefix":"org/","maxUploadSizeMb":64}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "initial-secret",
			"gcsServiceAccount": `{"client_email":"persisted@example.com","private_key":"-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n"}`,
		},
		Updated: baseTime,
	}

	inst, err := NewApp(ctx, initialSettings)
	if err != nil {
		t.Fatalf("NewApp returned error: %v", err)
	}
	app := inst.(*App)
	app.Dispose()

	restartCtx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})
	// Grafana can restart the plugin with defaults while still providing secure fields
	// that mirror what is already stored. Ensure those defaults do not overwrite the
	// persisted JSON configuration when that happens.
	defaultSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://default","bucketName":"","objectPrefix":"","maxUploadSizeMb":25}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "initial-secret",
			"gcsServiceAccount": `{"client_email":"persisted@example.com","private_key":"-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n"}`,
		},
		Updated: baseTime,
	}

	inst2, err := NewApp(restartCtx, defaultSettings)
	if err != nil {
		t.Fatalf("NewApp with defaults returned error: %v", err)
	}
	app2 := inst2.(*App)
	defer app2.Dispose()

	if app2.config.APIURL != "https://persisted" {
		t.Fatalf("expected API URL from persisted settings, got %q", app2.config.APIURL)
	}

	persisted, err := app2.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings returned error: %v", err)
	}
	if persisted == nil {
		t.Fatalf("expected persisted settings to exist")
	}
	if !strings.Contains(string(persisted.JSONData), "https://persisted") {
		t.Fatalf("expected persisted JSON to keep stored API URL, got %s", persisted.JSONData)
	}
}
