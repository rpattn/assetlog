package plugin

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const (
	defaultMaxUploadSizeMB = int64(25)
	maxAllowedUploadSizeMB = int64(5120)
	bytesInMegabyte        = int64(1024 * 1024)
)

type StorageConfig struct {
	Bucket             string
	Prefix             string
	MaxUploadSizeMB    int64
	MaxUploadSizeBytes int64
	ServiceAccountJSON []byte
}

type Config struct {
	APIURL  string
	APIKey  string
	Storage StorageConfig
}

func parseConfig(settings backend.AppInstanceSettings) (Config, error) {
	cfg := Config{
		Storage: StorageConfig{
			MaxUploadSizeMB:    defaultMaxUploadSizeMB,
			MaxUploadSizeBytes: defaultMaxUploadSizeMB * bytesInMegabyte,
		},
	}

	if len(settings.JSONData) > 0 {
		var raw struct {
			APIURL         string `json:"apiUrl"`
			BucketName     string `json:"bucketName"`
			ObjectPrefix   string `json:"objectPrefix"`
			MaxUploadSizeM int64  `json:"maxUploadSizeMb"`
		}
		if err := json.Unmarshal(settings.JSONData, &raw); err != nil {
			return cfg, fmt.Errorf("decode jsonData: %w", err)
		}

		cfg.APIURL = strings.TrimSpace(raw.APIURL)
		cfg.Storage.Bucket = strings.TrimSpace(raw.BucketName)
		cfg.Storage.Prefix = strings.TrimSpace(raw.ObjectPrefix)

		if raw.MaxUploadSizeM > 0 {
			sizeMB := raw.MaxUploadSizeM
			if sizeMB > maxAllowedUploadSizeMB {
				sizeMB = maxAllowedUploadSizeMB
			}
			cfg.Storage.MaxUploadSizeMB = sizeMB
			cfg.Storage.MaxUploadSizeBytes = sizeMB * bytesInMegabyte
		}
	}

	if settings.DecryptedSecureJSONData != nil {
		if apiKey, ok := settings.DecryptedSecureJSONData["apiKey"]; ok {
			cfg.APIKey = apiKey
		}
		if serviceAccount, ok := settings.DecryptedSecureJSONData["gcsServiceAccount"]; ok {
			cfg.Storage.ServiceAccountJSON = []byte(serviceAccount)
		}
	}

	return cfg, nil
}

func (s StorageConfig) IsFullyConfigured() bool {
	if localStorageOverrideEnabled() {
		return true
	}
	return s.Bucket != "" && len(s.ServiceAccountJSON) > 0
}
