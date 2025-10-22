package plugin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

var errStorageNotConfigured = errors.New("storage not configured")

const signedURLTTL = time.Hour

// StorageClient defines the interface used by the plugin to interact with
// object storage.
type StorageClient interface {
	Upload(ctx context.Context, object string, r io.Reader, size int64, contentType string) error
	Delete(ctx context.Context, object string) error
	SignedURL(ctx context.Context, object string, expires time.Duration) (string, error)
	Close() error
}

type localStorage struct {
	root   string
	prefix string
}

func newStorageClient(_ context.Context, cfg StorageConfig) (StorageClient, error) {
	if !cfg.IsFullyConfigured() {
		return nil, errStorageNotConfigured
	}
	basePath := os.Getenv("ASSETLOG_STORAGE_PATH")
	if strings.TrimSpace(basePath) == "" {
		basePath = filepath.Join(os.TempDir(), "assetlog-storage")
	}
	root := filepath.Join(basePath, cfg.Bucket)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create storage root: %w", err)
	}
	return &localStorage{root: root, prefix: strings.Trim(cfg.Prefix, "/")}, nil
}

func (s *localStorage) Upload(_ context.Context, object string, r io.Reader, _ int64, _ string) error {
	rel := s.prefixed(object)
	full := filepath.Join(s.root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("create storage directory: %w", err)
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read upload: %w", err)
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return fmt.Errorf("write object: %w", err)
	}
	return nil
}

func (s *localStorage) Delete(_ context.Context, object string) error {
	rel := s.prefixed(object)
	full := filepath.Join(s.root, filepath.FromSlash(rel))
	if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove object: %w", err)
	}
	return nil
}

func (s *localStorage) SignedURL(_ context.Context, object string, _ time.Duration) (string, error) {
	rel := s.prefixed(object)
	full := filepath.Join(s.root, filepath.FromSlash(rel))
	return "file://" + filepath.ToSlash(full), nil
}

func (s *localStorage) Close() error { return nil }

func (s *localStorage) prefixed(object string) string {
	object = strings.TrimLeft(object, "/")
	if s.prefix == "" {
		return object
	}
	return strings.TrimLeft(path.Join(s.prefix, object), "/")
}

// sanitizeObjectName removes any characters that could lead to unsafe object
// names when constructing keys from user provided filenames.
func sanitizeObjectName(name string) string {
	name = path.Base(name)
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r == '/' || r == '\\':
			return -1
		case r < 32:
			return -1
		}
		return r
	}, name)
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return ""
	}
	return cleaned
}
