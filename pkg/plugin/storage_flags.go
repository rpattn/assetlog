package plugin

import (
	"os"
	"strings"
)

func localStorageOverrideEnabled() bool {
	value := strings.TrimSpace(os.Getenv("ASSETLOG_FORCE_LOCAL_STORAGE"))
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
