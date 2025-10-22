package plugin

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"

	_ "modernc.org/sqlite"
)

const (
	envSQLitePath       = "SQLITE_PATH"
	envAssetlogDBPath   = "ASSETLOG_DB_PATH"
	envAssetlogDataPath = "ASSETLOG_DATA_PATH"
	envAssetlogDataDir  = "ASSETLOG_DATA_DIR"
	envGrafanaPathsData = "GF_PATHS_DATA"
	defaultAssetlogDir  = "/var/lib/rpatt-assetlog-app"
	defaultDatabaseName = "assets.db"
	pluginIdentifier    = "rpatt-assetlog-app"
)

func (a *App) initDatabase(ctx context.Context) error {
	candidates := sqlitePathCandidates(ctx)
	var lastErr error

	for _, candidate := range candidates {
		dir := filepath.Dir(candidate)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			lastErr = fmt.Errorf("create sqlite directory %q: %w", dir, err)
			log.Printf("sqlite candidate %s skipped: %v", candidate, err)
			continue
		}

		db, err := sql.Open("sqlite", candidate)
		if err != nil {
			lastErr = fmt.Errorf("open sqlite database at %q: %w", candidate, err)
			log.Printf("sqlite candidate %s skipped: %v", candidate, err)
			continue
		}

		if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
			lastErr = fmt.Errorf("enable foreign keys at %q: %w", candidate, err)
			log.Printf("sqlite candidate %s skipped: %v", candidate, err)
			db.Close()
			continue
		}

		if err := runMigrations(db); err != nil {
			lastErr = fmt.Errorf("apply migrations at %q: %w", candidate, err)
			log.Printf("sqlite candidate %s skipped: %v", candidate, err)
			db.Close()
			continue
		}

		a.db = db
		log.Printf("database initialized at: %s", candidate)
		return nil
	}

	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("no sqlite path candidates available")
}

func sqlitePathCandidates(ctx context.Context) []string {
	addCandidate := func(seen map[string]struct{}, list []string, candidate string) ([]string, map[string]struct{}) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return list, seen
		}
		if _, exists := seen[candidate]; exists {
			return list, seen
		}
		seen[candidate] = struct{}{}
		list = append(list, filepath.Clean(candidate))
		return list, seen
	}

	candidates := make([]string, 0, 8)
	seen := make(map[string]struct{})

	envValues := []string{
		os.Getenv(envSQLitePath),
		os.Getenv(envAssetlogDBPath),
		os.Getenv(envAssetlogDataPath),
	}

	for _, value := range envValues {
		candidates, seen = addCandidate(seen, candidates, value)
	}

	if dir := strings.TrimSpace(os.Getenv(envAssetlogDataDir)); dir != "" {
		candidates, seen = addCandidate(seen, candidates, filepath.Join(dir, defaultDatabaseName))
	}

	if dir := strings.TrimSpace(os.Getenv(envGrafanaPathsData)); dir != "" {
		candidates, seen = addCandidate(seen, candidates, filepath.Join(dir, "plugins", pluginIdentifier, defaultDatabaseName))
		candidates, seen = addCandidate(seen, candidates, filepath.Join(dir, pluginIdentifier, defaultDatabaseName))
	}

	if ctx != nil {
		if pluginCtx := backend.PluginConfigFromContext(ctx); pluginCtx.GrafanaConfig != nil {
			if dataPath := strings.TrimSpace(pluginCtx.GrafanaConfig.Get("paths.data")); dataPath != "" {
				candidates, seen = addCandidate(seen, candidates, filepath.Join(dataPath, "plugins", pluginIdentifier, defaultDatabaseName))
				candidates, seen = addCandidate(seen, candidates, filepath.Join(dataPath, pluginIdentifier, defaultDatabaseName))
			}
		}
	}

	candidates, seen = addCandidate(seen, candidates, filepath.Join(defaultAssetlogDir, defaultDatabaseName))

	if ex, err := os.Executable(); err == nil && strings.TrimSpace(ex) != "" {
		candidates, seen = addCandidate(seen, candidates, filepath.Join(filepath.Dir(ex), defaultDatabaseName))
	}

	candidates, _ = addCandidate(seen, candidates, filepath.Join(os.TempDir(), "assetlog", defaultDatabaseName))

	return candidates
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
