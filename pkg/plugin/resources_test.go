package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// mockCallResourceResponseSender implements backend.CallResourceResponseSender
// for use in tests.
type mockCallResourceResponseSender struct {
	response *backend.CallResourceResponse
}

// Send sets the received *backend.CallResourceResponse to s.response
func (s *mockCallResourceResponseSender) Send(response *backend.CallResourceResponse) error {
	s.response = response
	return nil
}

// TestCallResource tests CallResource calls, using backend.CallResourceRequest and backend.CallResourceResponse.
// This ensures the httpadapter for CallResource works correctly.
func TestCallResource(t *testing.T) {
	t.Setenv("SQLITE_PATH", filepath.Join(t.TempDir(), "assets.db"))

	// Initialize app
	inst, err := NewApp(context.Background(), backend.AppInstanceSettings{})
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	if inst == nil {
		t.Fatal("inst must not be nil")
	}
	app, ok := inst.(*App)
	if !ok {
		t.Fatal("inst must be of type *App")
	}

	// Set up and run test cases
	for _, tc := range []struct {
		name string

		method        string
		path          string
		body          []byte
		pluginContext backend.PluginContext

		expStatus int
		expBody   []byte
		verify    func(t *testing.T, resp *backend.CallResourceResponse)
	}{
		{
			name:      "get ping 200",
			method:    http.MethodGet,
			path:      "ping",
			expStatus: http.StatusOK,
		},
		{
			name:      "get echo 405",
			method:    http.MethodGet,
			path:      "echo",
			expStatus: http.StatusMethodNotAllowed,
		},
		{
			name:      "post echo 200",
			method:    http.MethodPost,
			path:      "echo",
			body:      []byte(`{"message":"ok"}`),
			expStatus: http.StatusOK,
			expBody:   []byte(`{"message":"ok"}`),
		},
		{
			name:          "get assets 200",
			method:        http.MethodGet,
			path:          "assets",
			pluginContext: backend.PluginContext{OrgID: 1},
			expStatus:     http.StatusOK,
			verify: func(t *testing.T, resp *backend.CallResourceResponse) {
				t.Helper()
				var payload struct {
					Data []AssetRecord `json:"data"`
				}
				if err := json.Unmarshal(resp.Body, &payload); err != nil {
					t.Fatalf("decode response: %v", err)
				}
				if len(payload.Data) == 0 {
					t.Fatalf("expected seeded assets, got none")
				}
				if payload.Data[0].CreatedAt == "" {
					t.Fatalf("expected created_at to be populated")
				}
			},
		},
		{
			name:      "get non existing handler 404",
			method:    http.MethodGet,
			path:      "not_found",
			expStatus: http.StatusNotFound,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Request by calling CallResource. This tests the httpadapter.
			var r mockCallResourceResponseSender
			err = app.CallResource(context.Background(), &backend.CallResourceRequest{
				Method:        tc.method,
				Path:          tc.path,
				Body:          tc.body,
				PluginContext: tc.pluginContext,
			}, &r)
			if err != nil {
				t.Fatalf("CallResource error: %s", err)
			}
			if r.response == nil {
				t.Fatal("no response received from CallResource")
			}
			if tc.expStatus > 0 && tc.expStatus != r.response.Status {
				t.Errorf("response status should be %d, got %d", tc.expStatus, r.response.Status)
			}
			if len(tc.expBody) > 0 {
				if tb := bytes.TrimSpace(r.response.Body); !bytes.Equal(tb, tc.expBody) {
					t.Errorf("response body should be %s, got %s", tc.expBody, tb)
				}
			}
			if tc.verify != nil {
				tc.verify(t, r.response)
			}
		})
	}
}
