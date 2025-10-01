package plugin

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path"

	_ "modernc.org/sqlite"
)

func (a *App) initDatabase() error {
	sqlitePath := os.Getenv("SQLITE_PATH")
	if sqlitePath == "" {
		ex, _ := os.Executable()
		dir := path.Dir(ex)
		sqlitePath = path.Join(dir, "assets.db")
	}

	db, err := sql.Open("sqlite", sqlitePath)
	if err != nil {
		return err
	}
	a.db = db

	var count int
	err = db.QueryRow("SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name='assets'").Scan(&count)
	if err != nil {
		return err
	}

	if count == 0 {
		sqlFile := "/var/lib/rpatt-assetlog-app/init.sql"
		data, err := os.ReadFile(sqlFile)
		if err != nil {
			return fmt.Errorf("failed to read init.sql: %w", err)
		}
		if _, err := db.Exec(string(data)); err != nil {
			return fmt.Errorf("failed to execute init.sql: %w", err)
		}
	}
	log.Printf("database initialized at: %s", sqlitePath)
	return nil
}
