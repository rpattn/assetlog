package plugin

import (
	"os"
	"strings"
)

const envForceLocalStorage = "ASSETLOG_FORCE_LOCAL_STORAGE"

func localStorageOverrideEnabled() bool {
	value := strings.TrimSpace(os.Getenv(envForceLocalStorage))
	if value == "" {
		return false
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}
