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

	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return fmt.Errorf("enable foreign keys: %w", err)
	}

	if err := runMigrations(db); err != nil {
		db.Close()
		return err
	}

	a.db = db
	log.Printf("database initialized at: %s", sqlitePath)
	return nil
}

func runMigrations(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	var current int
	if err := db.QueryRow(`SELECT IFNULL(MAX(version), 0) FROM schema_migrations`).Scan(&current); err != nil {
		return fmt.Errorf("query current schema version: %w", err)
	}

	for _, m := range migrations {
		if m.version <= current {
			continue
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", m.version, err)
		}

		if _, err := tx.Exec(m.script); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %d (%s): %w", m.version, migrationName(m.version), err)
		}

		if _, err := tx.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, m.version); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.version, err)
		}
		log.Printf("applied migration %d (%s)", m.version, migrationName(m.version))
	}

	return nil
}
