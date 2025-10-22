package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const maxAssetPayloadSize = 1 << 20
const attachmentFormField = "file"

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
		meta := map[string]interface{}{
			"storageConfigured":  a.storageConfigured(),
			"maxUploadSizeBytes": a.config.Storage.MaxUploadSizeBytes,
			"maxUploadSizeMb":    a.config.Storage.MaxUploadSizeMB,
		}
		if a.storageInitErr != nil {
			meta["storageError"] = a.storageInitErr.Error()
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"data": assets, "meta": meta})
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
		switch {
		case r.Method == http.MethodPost && len(segments) == 2:
			a.handleAssetFileUpload(w, r, orgID, assetID)
		case r.Method == http.MethodDelete && len(segments) == 3:
			fileID, err := strconv.ParseInt(segments[2], 10, 64)
			if err != nil {
				http.Error(w, "invalid file id", http.StatusBadRequest)
				return
			}
			a.handleAssetFileDelete(w, r, orgID, assetID, fileID)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	http.NotFound(w, r)
}

func (a *App) handleAssetFileUpload(w http.ResponseWriter, r *http.Request, orgID, assetID int64) {
	if !a.storageConfigured() {
		msg := "attachments not configured"
		if a.storageInitErr != nil {
			msg = fmt.Sprintf("attachments unavailable: %v", a.storageInitErr)
		}
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	if err := a.ensureAssetExists(r.Context(), orgID, assetID); err != nil {
		writeHTTPError(w, err)
		return
	}

	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, "invalid multipart form", http.StatusBadRequest)
		return
	}

	maxSize := a.config.Storage.MaxUploadSizeBytes
	if maxSize <= 0 {
		maxSize = defaultMaxUploadSizeMB * bytesInMegabyte
	}

	var part *multipart.Part
	for {
		p, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			http.Error(w, "failed to read upload", http.StatusBadRequest)
			return
		}
		if p.FormName() == attachmentFormField {
			part = p
			break
		}
		p.Close()
	}

	if part == nil {
		http.Error(w, "missing file upload", http.StatusBadRequest)
		return
	}
	defer part.Close()

	data, err := io.ReadAll(io.LimitReader(part, maxSize+1))
	if err != nil {
		http.Error(w, "failed to read file", http.StatusBadRequest)
		return
	}
	if int64(len(data)) > maxSize {
		http.Error(w, fmt.Sprintf("file exceeds maximum size of %d bytes", maxSize), http.StatusBadRequest)
		return
	}
	if len(data) == 0 {
		http.Error(w, "file is empty", http.StatusBadRequest)
		return
	}

	filename := strings.TrimSpace(part.FileName())
	if filename == "" {
		filename = fmt.Sprintf("attachment-%d", time.Now().Unix())
	}
	contentType := part.Header.Get("Content-Type")
	if strings.TrimSpace(contentType) == "" {
		contentType = http.DetectContentType(data)
	}

	storageKey := a.generateStorageKey(orgID, assetID, filename)
	if err := a.storage.Upload(r.Context(), storageKey, bytes.NewReader(data), int64(len(data)), contentType); err != nil {
		log.Printf("upload attachment failed: %v", err)
		http.Error(w, "failed to upload attachment", http.StatusInternalServerError)
		return
	}

	file, err := a.insertAssetFile(r.Context(), orgID, assetID, filename, contentType, storageKey)
	if err != nil {
		log.Printf("insert asset file failed: %v", err)
		if delErr := a.storage.Delete(r.Context(), storageKey); delErr != nil {
			log.Printf("cleanup storage failed: %v", delErr)
		}
		writeHTTPError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{"data": file})
}

func (a *App) handleAssetFileDelete(w http.ResponseWriter, r *http.Request, orgID, assetID, fileID int64) {
	if err := a.deleteAssetFile(r.Context(), orgID, assetID, fileID); err != nil {
		writeHTTPError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) handleAppSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if _, err := resolveOrgIDFromRequest(r); err != nil {
		writeHTTPError(w, err)
		return
	}

	storageInfo := map[string]interface{}{"configured": a.storageConfigured()}
	if a.storageInitErr != nil {
		storageInfo["error"] = a.storageInitErr.Error()
	}

	payload := map[string]interface{}{
		"jsonData": map[string]interface{}{
			"apiUrl":          a.config.APIURL,
			"bucketName":      a.config.Storage.Bucket,
			"objectPrefix":    a.config.Storage.Prefix,
			"maxUploadSizeMb": a.config.Storage.MaxUploadSizeMB,
		},
		"secureJsonFields": map[string]bool{
			"apiKey":            a.config.APIKey != "",
			"gcsServiceAccount": len(a.config.Storage.ServiceAccountJSON) > 0,
		},
		"storage": storageInfo,
	}

	writeJSON(w, http.StatusOK, payload)
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
	case errors.Is(err, errAssetFileNotFound):
		http.Error(w, "file not found", http.StatusNotFound)
	default:
		log.Printf("handler error: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}
