package plugin

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
)

const maxAssetPayloadSize = 1 << 20

type httpError struct {
	status  int
	message string
}

func (e httpError) Error() string {
	return e.message
}

func (a *App) handleAssetsCollection(w http.ResponseWriter, r *http.Request) {
	orgID, err := resolveOrgIDFromRequest(r)
	if err != nil {
		writeHTTPError(w, err)
		return
	}

	switch r.Method {
	case http.MethodGet:
		assets, err := a.listAssets(r.Context(), orgID)
		if err != nil {
			log.Printf("listAssets failed: %v", err)
			http.Error(w, "internal server error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"data": assets})
	case http.MethodPost:
		payload, err := decodeAssetPayload(r)
		if err != nil {
			writeHTTPError(w, err)
			return
		}
		asset, err := a.createAsset(r.Context(), orgID, payload)
		if err != nil {
			writeHTTPError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]interface{}{"data": asset})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *App) handleAssetResource(w http.ResponseWriter, r *http.Request) {
	orgID, err := resolveOrgIDFromRequest(r)
	if err != nil {
		writeHTTPError(w, err)
		return
	}

	suffix := strings.TrimPrefix(r.URL.Path, "/assets/")
	if suffix == "" {
		http.NotFound(w, r)
		return
	}
	segments := strings.Split(strings.Trim(suffix, "/"), "/")
	if len(segments) == 0 {
		http.NotFound(w, r)
		return
	}

	assetID, err := strconv.ParseInt(segments[0], 10, 64)
	if err != nil {
		http.Error(w, "invalid asset id", http.StatusBadRequest)
		return
	}

	if len(segments) == 1 {
		switch r.Method {
		case http.MethodGet:
			asset, err := a.getAsset(r.Context(), orgID, assetID)
			if err != nil {
				writeHTTPError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"data": asset})
		case http.MethodPut:
			payload, err := decodeAssetPayload(r)
			if err != nil {
				writeHTTPError(w, err)
				return
			}
			asset, err := a.updateAsset(r.Context(), orgID, assetID, payload)
			if err != nil {
				writeHTTPError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]interface{}{"data": asset})
		case http.MethodDelete:
			if err := a.deleteAsset(r.Context(), orgID, assetID); err != nil {
				writeHTTPError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	if len(segments) >= 2 && segments[1] == "files" {
		http.Error(w, "not implemented", http.StatusNotImplemented)
		return
	}

	http.NotFound(w, r)
}

func decodeAssetPayload(r *http.Request) (AssetPayload, error) {
	defer func() {
		io.Copy(io.Discard, r.Body)
		r.Body.Close()
	}()

	var payload AssetPayload
	dec := json.NewDecoder(io.LimitReader(r.Body, maxAssetPayloadSize))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&payload); err != nil {
		return AssetPayload{}, validationError{message: "invalid JSON payload: " + err.Error()}
	}
	return payload, nil
}

func resolveOrgIDFromRequest(r *http.Request) (int64, error) {
	var requestedOrg *int64
	if v := strings.TrimSpace(r.URL.Query().Get("orgId")); v != "" {
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return 0, validationError{message: "invalid orgId query parameter"}
		}
		requestedOrg = &parsed
	}

	if pc, ok := PluginContextFromRequest(r); ok {
		if requestedOrg != nil && *requestedOrg != pc.OrgID {
			return 0, httpError{status: http.StatusForbidden, message: "forbidden: organization mismatch"}
		}
		return pc.OrgID, nil
	}

	orgID, err := getOrgFromRequest(r)
	if err != nil {
		return 0, httpError{status: http.StatusForbidden, message: "forbidden: could not determine caller organization"}
	}
	if requestedOrg != nil && *requestedOrg != orgID {
		return 0, httpError{status: http.StatusForbidden, message: "forbidden: organization mismatch"}
	}
	return orgID, nil
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encode response failed: %v", err)
	}
}

func writeHTTPError(w http.ResponseWriter, err error) {
	var httpErr httpError
	var valErr validationError
	switch {
	case errors.As(err, &httpErr):
		http.Error(w, httpErr.message, httpErr.status)
	case errors.As(err, &valErr):
		http.Error(w, valErr.Error(), http.StatusBadRequest)
	case errors.Is(err, errAssetNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	default:
		log.Printf("handler error: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}
