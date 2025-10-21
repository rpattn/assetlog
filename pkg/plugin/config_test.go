package plugin

import (
	"context"
	"fmt"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestParseConfigDefaults(t *testing.T) {
	cfg, err := parseConfig(backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("parseConfig returned error: %v", err)
	}
	if cfg.Storage.MaxUploadSizeMB != defaultMaxUploadSizeMB {
		t.Fatalf("expected default max upload size %d, got %d", defaultMaxUploadSizeMB, cfg.Storage.MaxUploadSizeMB)
	}
	expectedBytes := defaultMaxUploadSizeMB * bytesInMegabyte
	if cfg.Storage.MaxUploadSizeBytes != expectedBytes {
		t.Fatalf("expected max upload size bytes %d, got %d", expectedBytes, cfg.Storage.MaxUploadSizeBytes)
	}
	if cfg.Storage.Bucket != "" {
		t.Fatalf("expected empty bucket, got %q", cfg.Storage.Bucket)
	}
	if cfg.Storage.IsFullyConfigured() {
		t.Fatalf("storage should not be marked as configured")
	}
}

func TestParseConfigFromSettings(t *testing.T) {
	settings := backend.AppInstanceSettings{
		JSONData: []byte(`{"apiUrl":"https://example.com","bucketName":" my-bucket ","objectPrefix":" prefix/ ","maxUploadSizeMb":128}`),
		DecryptedSecureJSONData: map[string]string{
			"apiKey":            "secret",
			"gcsServiceAccount": "{}",
		},
	}
	cfg, err := parseConfig(settings)
	if err != nil {
		t.Fatalf("parseConfig returned error: %v", err)
	}
	if cfg.APIURL != "https://example.com" {
		t.Fatalf("unexpected api url: %s", cfg.APIURL)
	}
	if cfg.APIKey != "secret" {
		t.Fatalf("unexpected api key")
	}
	if cfg.Storage.Bucket != "my-bucket" {
		t.Fatalf("bucket should be trimmed, got %q", cfg.Storage.Bucket)
	}
	if cfg.Storage.Prefix != "prefix/" {
		t.Fatalf("prefix should be trimmed, got %q", cfg.Storage.Prefix)
	}
	if cfg.Storage.MaxUploadSizeMB != 128 {
		t.Fatalf("expected upload size 128, got %d", cfg.Storage.MaxUploadSizeMB)
	}
	if cfg.Storage.MaxUploadSizeBytes != 128*bytesInMegabyte {
		t.Fatalf("unexpected upload size bytes: %d", cfg.Storage.MaxUploadSizeBytes)
	}
	if !cfg.Storage.IsFullyConfigured() {
		t.Fatalf("storage should be configured")
	}
}

func TestParseConfigClampsUploadSize(t *testing.T) {
	overLimit := maxAllowedUploadSizeMB + 500
	settings := backend.AppInstanceSettings{
		JSONData: []byte(fmt.Sprintf(`{"maxUploadSizeMb":%d}`, overLimit)),
	}
	cfg, err := parseConfig(settings)
	if err != nil {
		t.Fatalf("parseConfig returned error: %v", err)
	}
	if cfg.Storage.MaxUploadSizeMB != maxAllowedUploadSizeMB {
		t.Fatalf("expected clamp to %d, got %d", maxAllowedUploadSizeMB, cfg.Storage.MaxUploadSizeMB)
	}
	if cfg.Storage.MaxUploadSizeBytes != maxAllowedUploadSizeMB*bytesInMegabyte {
		t.Fatalf("unexpected max upload bytes: %d", cfg.Storage.MaxUploadSizeBytes)
	}
}

func TestParseConfigInvalidJSON(t *testing.T) {
	if _, err := parseConfig(backend.AppInstanceSettings{JSONData: []byte("{")}); err == nil {
		t.Fatalf("expected error when json is invalid")
	}
}

func TestCheckHealthStorageWarnings(t *testing.T) {
	app := &App{config: Config{}}

	res, err := app.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
	if err != nil {
		t.Fatalf("CheckHealth returned error: %v", err)
	}
	if res.Status != backend.HealthStatusError {
		t.Fatalf("expected error status when storage missing, got %v", res.Status)
	}

	app.config.Storage.Bucket = "bucket"
	app.config.Storage.ServiceAccountJSON = []byte("{}")

	res, err = app.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
	if err != nil {
		t.Fatalf("CheckHealth returned error: %v", err)
	}
	if res.Status != backend.HealthStatusOk {
		t.Fatalf("expected ok status when storage configured, got %v", res.Status)
	}
}
