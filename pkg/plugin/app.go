package plugin

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

type App struct {
	backend.CallResourceHandler
	db      *sql.DB
	storage StorageClient
	// config stores the current plugin configuration for reuse by handlers.
	config Config
}

type withContextHandler struct {
	inner backend.CallResourceHandler
}

func (h *withContextHandler) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	ctx = SetPluginContext(ctx, req.PluginContext)
	return h.inner.CallResource(ctx, req, sender)
}

func NewApp(ctx context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	cfg, err := parseConfig(settings)
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	a := &App{config: cfg}
	if cfg.Storage.IsFullyConfigured() {
		storageClient, err := newStorageClient(ctx, cfg.Storage)
		if err != nil {
			return nil, fmt.Errorf("init storage: %w", err)
		}
		a.storage = storageClient
	}
	if err := a.initDatabase(); err != nil {
		return nil, fmt.Errorf("initDatabase: %w", err)
	}
	mux := http.NewServeMux()
	a.registerRoutes(mux)
	a.CallResourceHandler = &withContextHandler{inner: httpadapter.New(mux)}
	return a, nil
}

func (a *App) Dispose() {
	if a.db != nil {
		_ = a.db.Close()
		a.db = nil
	}
	if a.storage != nil {
		_ = a.storage.Close()
		a.storage = nil
	}
}

func (a *App) storageConfigured() bool {
	return a.storage != nil && a.config.Storage.IsFullyConfigured()
}

func (a *App) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if a.db != nil {
		if err := a.db.Ping(); err != nil {
			return &backend.CheckHealthResult{
				Status:  backend.HealthStatusError,
				Message: fmt.Sprintf("db ping failed: %v", err),
			}, nil
		}
	}
	status := backend.HealthStatusOk
	message := "ok"
	if localStorageOverrideEnabled() {
		return &backend.CheckHealthResult{Status: status, Message: "local storage override enabled"}, nil
	}
	switch {
	case a.config.Storage.Bucket == "" && len(a.config.Storage.ServiceAccountJSON) == 0:
		status = backend.HealthStatusError
		message = "storage bucket and service account not configured"
	case a.config.Storage.Bucket == "":
		status = backend.HealthStatusError
		message = "storage bucket not configured"
	case len(a.config.Storage.ServiceAccountJSON) == 0:
		status = backend.HealthStatusError
		message = "storage service account not configured"
	}
	return &backend.CheckHealthResult{Status: status, Message: message}, nil
}
