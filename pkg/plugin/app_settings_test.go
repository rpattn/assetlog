package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
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
	initialPersisted, err := app.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings returned error: %v", err)
	}
	if initialPersisted == nil {
		t.Fatalf("expected persisted settings to be stored")
	}
	app.Dispose()

	// Simulate Grafana restarting the plugin with default/empty settings.
	resetCtx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})
	resetSettings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"http://default-url.com","bucketName":"default-bucket","objectPrefix":"uploads/","maxUploadSizeMb":25}`),
	}

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

	persistedAfter, err := app2.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings after reset returned error: %v", err)
	}
	if persistedAfter == nil {
		t.Fatalf("expected persisted settings to exist after restart")
	}
	if string(persistedAfter.JSONData) != string(initialPersisted.JSONData) {
		t.Fatalf("expected persisted JSON to remain unchanged, got %s", string(persistedAfter.JSONData))
	}
	if persistedAfter.SecureJSONData["apiKey"] != "initial-key" {
		t.Fatalf("expected persisted api key to remain unchanged, got %q", persistedAfter.SecureJSONData["apiKey"])
	}
	if !initialPersisted.UpdatedAt.IsZero() && !persistedAfter.UpdatedAt.Equal(initialPersisted.UpdatedAt) {
		t.Fatalf("expected persisted updated_at to remain unchanged")
	}
}

func TestNewAppSkipsProvisionedDefaultsAfterUserUpdate(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	t.Setenv("SQLITE_PATH", dbPath)
	t.Setenv(envForceLocalStorage, "1")

	orgID := int64(1)
	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})

	provisioned := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"http://default-url.com","bucketName":"assetlog-dev-bucket","objectPrefix":"uploads/","maxUploadSizeMb":25}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "default-key",
			"gcsServiceAccount": `{"type":"service_account"}`,
		},
	}

	inst, err := NewApp(ctx, provisioned)
	if err != nil {
		t.Fatalf("initial NewApp returned error: %v", err)
	}
	app := inst.(*App)

	persistedSeed, err := app.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings returned error: %v", err)
	}
	if persistedSeed == nil {
		t.Fatalf("expected provisioned settings to be persisted on first run")
	}
	app.Dispose()

	updatedTime := time.Now().UTC().Add(time.Minute)
	updated := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://custom.example","bucketName":"user-bucket","objectPrefix":"custom/","maxUploadSizeMb":42}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey": "custom-key",
		},
		Updated: updatedTime,
	}

	inst2, err := NewApp(ctx, updated)
	if err != nil {
		t.Fatalf("updated NewApp returned error: %v", err)
	}
	app2 := inst2.(*App)

	persistedUser, err := app2.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings after update returned error: %v", err)
	}
	if persistedUser == nil {
		t.Fatalf("expected persisted settings to exist after user update")
	}
	app2.Dispose()

	restartCtx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})
	restartDefaults := backend.AppInstanceSettings{
		JSONData:                provisioned.JSONData,
		DecryptedSecureJSONData: provisioned.DecryptedSecureJSONData,
		Updated:                 updatedTime.Add(5 * time.Minute),
	}

	inst3, err := NewApp(restartCtx, restartDefaults)
	if err != nil {
		t.Fatalf("restart NewApp returned error: %v", err)
	}
	app3 := inst3.(*App)
	defer app3.Dispose()

	persistedFinal, err := app3.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings after restart returned error: %v", err)
	}
	if persistedFinal == nil {
		t.Fatalf("expected persisted settings after restart")
	}

	cfg, err := parseConfig(backend.AppInstanceSettings{
		JSONData:                persistedFinal.JSONData,
		DecryptedSecureJSONData: persistedFinal.SecureJSONData,
	})
	if err != nil {
		t.Fatalf("parse persisted config failed: %v", err)
	}

	if cfg.APIURL != "https://custom.example" {
		t.Fatalf("expected persisted API URL to remain custom, got %q", cfg.APIURL)
	}
	if cfg.Storage.Bucket != "user-bucket" {
		t.Fatalf("expected persisted bucket to remain custom, got %q", cfg.Storage.Bucket)
	}
	if cfg.APIKey != "custom-key" {
		t.Fatalf("expected persisted API key to remain custom, got %q", cfg.APIKey)
	}

	if !jsonEqualForTest(persistedFinal.ProvisionedJSONData, provisioned.JSONData) {
		t.Fatalf("expected provisioned JSON to match defaults")
	}
	if !mapsEqualForTest(persistedFinal.ProvisionedSecureJSONData, provisioned.DecryptedSecureJSONData) {
		t.Fatalf("expected provisioned secure JSON to match defaults")
	}
	if !persistedUser.UpdatedAt.IsZero() && !persistedFinal.UpdatedAt.Equal(persistedUser.UpdatedAt) {
		t.Fatalf("expected persisted updated_at to remain unchanged after restart")
	}
}

func TestNewAppUpdatesPersistedSettingsWithGrafanaChanges(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "assets.db")
	t.Setenv("SQLITE_PATH", dbPath)
	t.Setenv(envForceLocalStorage, "1")

	orgID := int64(23)
	serviceAccount := `{"client_email":"svc@example.com","private_key":"-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n"}`

	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})
	initial := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://initial.example","bucketName":"initial-bucket","objectPrefix":"initial/","maxUploadSizeMb":16}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "initial-key",
			"gcsServiceAccount": serviceAccount,
		},
		Updated: time.Now().UTC(),
	}

	inst, err := NewApp(ctx, initial)
	if err != nil {
		t.Fatalf("initial NewApp returned error: %v", err)
	}
	app := inst.(*App)
	app.Dispose()

	updatedCtx := backend.WithPluginContext(context.Background(), backend.PluginContext{OrgID: orgID})
	updated := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://updated.example","bucketName":"updated-bucket","objectPrefix":"updated/","maxUploadSizeMb":128}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey": "updated-key",
		},
		Updated: time.Now().UTC().Add(time.Minute),
	}

	inst2, err := NewApp(updatedCtx, updated)
	if err != nil {
		t.Fatalf("updated NewApp returned error: %v", err)
	}
	app2 := inst2.(*App)
	defer app2.Dispose()

	if app2.config.APIURL != "https://updated.example" {
		t.Fatalf("expected updated API URL, got %q", app2.config.APIURL)
	}
	if app2.config.Storage.Bucket != "updated-bucket" {
		t.Fatalf("expected updated bucket, got %q", app2.config.Storage.Bucket)
	}
	if app2.config.APIKey != "updated-key" {
		t.Fatalf("expected updated API key, got %q", app2.config.APIKey)
	}
	if string(app2.config.Storage.ServiceAccountJSON) != serviceAccount {
		t.Fatalf("expected service account to be preserved, got %q", string(app2.config.Storage.ServiceAccountJSON))
	}

	persisted, err := app2.loadPersistedAppSettings(context.Background(), orgID)
	if err != nil {
		t.Fatalf("loadPersistedAppSettings returned error: %v", err)
	}
	if persisted == nil {
		t.Fatalf("expected persisted settings to exist")
	}

	persistedCfg, err := parseConfig(backend.AppInstanceSettings{
		JSONData:                persisted.JSONData,
		DecryptedSecureJSONData: persisted.SecureJSONData,
	})
	if err != nil {
		t.Fatalf("parse persisted config failed: %v", err)
	}

	if persistedCfg.APIURL != "https://updated.example" {
		t.Fatalf("expected persisted API URL to be updated, got %q", persistedCfg.APIURL)
	}
	if persistedCfg.Storage.Bucket != "updated-bucket" {
		t.Fatalf("expected persisted bucket to be updated, got %q", persistedCfg.Storage.Bucket)
	}
	if persistedCfg.APIKey != "updated-key" {
		t.Fatalf("expected persisted API key to be updated, got %q", persistedCfg.APIKey)
	}
	if string(persistedCfg.Storage.ServiceAccountJSON) != serviceAccount {
		t.Fatalf("expected persisted service account to be preserved, got %q", string(persistedCfg.Storage.ServiceAccountJSON))
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

func jsonEqualForTest(a, b []byte) bool {
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

func mapsEqualForTest(a, b map[string]string) bool {
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
