package plugin

import (
	_ "embed"
	"fmt"
)

var migrations = []struct {
	version int
	name    string
	script  string
}{
	{version: 1, name: "init", script: migration0001},
	{version: 2, name: "attachments", script: migration0002},
	{version: 3, name: "app_settings", script: migration0003},
	{version: 4, name: "app_settings_provisioned", script: migration0004},
}

//go:embed migrations/0001_init.sql
var migration0001 string

//go:embed migrations/0002_attachments.sql
var migration0002 string

//go:embed migrations/0003_app_settings.sql
var migration0003 string

//go:embed migrations/0004_app_settings_provisioned.sql
var migration0004 string

func migrationName(version int) string {
	for _, m := range migrations {
		if m.version == version {
			return m.name
		}
	}
	return fmt.Sprintf("migration_%d", version)
}
