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
}

//go:embed migrations/0001_init.sql
var migration0001 string

//go:embed migrations/0002_attachments.sql
var migration0002 string

func migrationName(version int) string {
	for _, m := range migrations {
		if m.version == version {
			return m.name
		}
	}
	return fmt.Sprintf("migration_%d", version)
}
