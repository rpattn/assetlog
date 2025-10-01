package plugin

import (
	"context"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Opaque context key type to avoid collisions
type pluginContextKey struct{}

var pluginCtxKey = pluginContextKey{}

// SetPluginContext injects Grafana's PluginContext into a context
func SetPluginContext(ctx context.Context, pc backend.PluginContext) context.Context {
	return context.WithValue(ctx, pluginCtxKey, pc)
}

// PluginContextFromContext retrieves the PluginContext from a context
func PluginContextFromContext(ctx context.Context) (backend.PluginContext, bool) {
	v := ctx.Value(pluginCtxKey)
	if v == nil {
		return backend.PluginContext{}, false
	}
	pc, ok := v.(backend.PluginContext)
	return pc, ok
}

// PluginContextFromRequest retrieves PluginContext from an *http.Request
func PluginContextFromRequest(r *http.Request) (backend.PluginContext, bool) {
	return PluginContextFromContext(r.Context())
}
