// File: plugin/resources.go
package plugin

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
)

// handlePing returns {"message":"ok"} with a 200 status.
func (a *App) handlePing(w http.ResponseWriter, req *http.Request) {
	resp := map[string]string{"message": "ok"}

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(resp); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(buf.Bytes()); err != nil {
		// can't change response at this point; just return
		return
	}
}

// handleEcho accepts JSON POST bodies like {"message":"..."} and echoes them back.
func (a *App) handleEcho(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer func() {
		io.Copy(io.Discard, req.Body)
		req.Body.Close()
	}()

	var body struct {
		Message string `json:"message"`
	}

	const maxBodySize = 1 << 20 // 1 MiB
	dec := json.NewDecoder(io.LimitReader(req.Body, maxBodySize))
	if err := dec.Decode(&body); err != nil {
		http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
		return
	}

	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(buf.Bytes()); err != nil {
		return
	}
}

// registerRoutes registers resource routes on the provided mux.
// Ensure /assets is registered so Grafana's /api/plugins/<id>/resources/assets
// requests are routed to a.assetsHandler.
func (a *App) registerRoutes(mux *http.ServeMux) {
	// specific routes first
	mux.HandleFunc("/ping", a.handlePing)
	mux.HandleFunc("/echo", a.handleEcho)

        // register the assets routes (must match what the frontend calls)
        mux.HandleFunc("/assets", a.handleAssetsCollection)
        mux.HandleFunc("/assets/", a.handleAssetResource)

	// fallback debug handler - runs only if no other route matches.
	// Logs the incoming path so you can see what Grafana forwards.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("DEBUG: resource request: method=%s path=%s remote=%s", r.Method, r.URL.Path, r.RemoteAddr)
		http.NotFound(w, r)
	})
}
