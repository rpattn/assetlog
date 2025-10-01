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
	db *sql.DB
}

type withContextHandler struct {
	inner backend.CallResourceHandler
}

func (h *withContextHandler) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	ctx = SetPluginContext(ctx, req.PluginContext)
	return h.inner.CallResource(ctx, req, sender)
}

func NewApp(_ context.Context, _ backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	a := &App{}
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
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "ok"}, nil
}
