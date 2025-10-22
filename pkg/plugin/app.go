package plugin

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

type App struct {
	backend.CallResourceHandler
	db      *sql.DB
	storage StorageClient
	// storageInitErr keeps track of storage initialization failures so we can surface them in health checks.
	storageInitErr error
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
	a := &App{}
	if err := a.initDatabase(ctx); err != nil {
		return nil, fmt.Errorf("initDatabase: %w", err)
	}

	pluginCtx := backend.PluginConfigFromContext(ctx)
	effectiveSettings := mergeAppInstanceSettings(settings, nil)
	var persisted *persistedAppSettings
	var persistCandidate *backend.AppInstanceSettings

	if pluginCtx.OrgID != 0 {
		var err error
		persisted, err = a.loadPersistedAppSettings(ctx, pluginCtx.OrgID)
		if err != nil {
			log.Printf("load persisted app settings for org %d failed: %v", pluginCtx.OrgID, err)
		} else if persisted != nil {
			log.Printf("loaded persisted app settings for org %d", pluginCtx.OrgID)
		}

		switch {
		case persisted == nil:
			if hasNonEmptySettings(settings) {
				candidate := mergeAppInstanceSettings(settings, nil)
				persistCandidate = &candidate
				effectiveSettings = candidate
			} else {
				effectiveSettings = mergeAppInstanceSettings(settings, nil)
			}
		case shouldPersistUpdate(settings, persisted):
			candidate := mergeAppInstanceSettings(settings, persisted)
			persistCandidate = &candidate
			effectiveSettings = candidate
		default:
			effectiveSettings = persistedToAppInstanceSettings(persisted, settings.APIVersion)
		}
	}

	cfg, err := parseConfig(effectiveSettings)
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if pluginCtx.OrgID != 0 {
		switch {
		case persistCandidate != nil:
			if err := a.savePersistedAppSettings(ctx, pluginCtx.OrgID, *persistCandidate); err != nil {
				log.Printf("persist app settings for org %d failed: %v", pluginCtx.OrgID, err)
			} else if persisted == nil {
				log.Printf("persisted app settings for org %d", pluginCtx.OrgID)
			} else {
				log.Printf("updated persisted app settings for org %d", pluginCtx.OrgID)
			}
		case persisted != nil:
			log.Printf("using persisted app settings for org %d", pluginCtx.OrgID)
		}
	}

	a.config = cfg
	a.storageInitErr = nil
	if cfg.Storage.IsFullyConfigured() {
		storageClient, err := newStorageClient(ctx, cfg.Storage)
		if err != nil {
			log.Printf("storage initialization failed: %v", err)
			a.storageInitErr = err
		} else {
			a.storage = storageClient
		}
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
	if a.storageInitErr != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("storage initialization failed: %v", a.storageInitErr),
		}, nil
	}
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
