package plugin

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestSqlitePathCandidatesIncludesAssetlogDataDir(t *testing.T) {
	t.Setenv(envSQLitePath, "")
	t.Setenv(envAssetlogDBPath, "")
	t.Setenv(envAssetlogDataPath, "")
	t.Setenv(envGrafanaPathsData, "")

	dataDir := t.TempDir()
	t.Setenv(envAssetlogDataDir, dataDir)

	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{})
	candidates := sqlitePathCandidates(ctx)

	expected := filepath.Join(dataDir, defaultDatabaseName)
	if !containsCandidate(candidates, expected) {
		t.Fatalf("expected sqlite path candidates to include %q, got %v", expected, candidates)
	}
}

func TestInitDatabaseCreatesFileInAssetlogDataDir(t *testing.T) {
	t.Setenv(envSQLitePath, "")
	t.Setenv(envAssetlogDBPath, "")
	t.Setenv(envAssetlogDataPath, "")
	t.Setenv(envGrafanaPathsData, "")

	dataDir := t.TempDir()
	t.Setenv(envAssetlogDataDir, dataDir)

	app := &App{}
	ctx := backend.WithPluginContext(context.Background(), backend.PluginContext{})
	if err := app.initDatabase(ctx); err != nil {
		t.Fatalf("initDatabase returned error: %v", err)
	}
	t.Cleanup(app.Dispose)

	expected := filepath.Join(dataDir, defaultDatabaseName)
	if _, err := os.Stat(expected); err != nil {
		t.Fatalf("expected database file at %s: %v", expected, err)
	}
}

func containsCandidate(candidates []string, candidate string) bool {
	candidate = filepath.Clean(candidate)
	for _, c := range candidates {
		if filepath.Clean(c) == candidate {
			return true
		}
	}
	return false
}
