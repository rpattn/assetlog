package plugin

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

type AssetRecord struct {
	ID                interface{} `json:"id"`
	Title             string      `json:"title"`
	EntryDate         string      `json:"entry_date"`
	CommissioningDate string      `json:"commissioning_date"`
	StationName       string      `json:"station_name"`
	Technician        string      `json:"technician"`
	StartDate         string      `json:"start_date"`
	EndDate           string      `json:"end_date"`
	Service           string      `json:"service"`
	Staff             []string    `json:"staff"`
	Latitude          float64     `json:"latitude"`
	Longitude         float64     `json:"longitude"`
	Pitch             float64     `json:"pitch"`
	Roll              float64     `json:"roll"`
	ImageURLs         []string    `json:"image_urls"`
}

func (a *App) assetsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var requestedOrgID *int64
	if q := r.URL.Query().Get("orgId"); q != "" {
		if parsed, err := strconv.ParseInt(q, 10, 64); err == nil {
			requestedOrgID = &parsed
		}
	}

	var callerOrg int64
	if pc, ok := PluginContextFromRequest(r); ok {
		callerOrg = pc.OrgID
	} else {
		org, err := getOrgFromRequest(r)
		if err != nil {
			log.Printf("strict validation: failed to resolve org: %v", err)
			http.Error(w, "forbidden: could not determine caller organization", http.StatusForbidden)
			return
		}
		callerOrg = org
	}
	log.Printf("ORG:%d", callerOrg)

	if requestedOrgID != nil && *requestedOrgID != callerOrg {
		log.Printf("strict validation: requested org %d does not match caller org %d", *requestedOrgID, callerOrg)
		http.Error(w, "forbidden: organization mismatch", http.StatusForbidden)
		return
	}

	rows, err := a.db.Query(`SELECT id, title, entry_date, commissioning_date, station_name, technician, start_date, end_date, service, staff, latitude, longitude, pitch, roll, images FROM assets WHERE org_id = ?`, callerOrg)
	if err != nil {
		log.Printf("query failed: %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var results []AssetRecord
	for rows.Next() {
		var asset AssetRecord
		var staffRaw, imagesRaw sqlNullString
		if err := rows.Scan(&asset.ID, &asset.Title, &asset.EntryDate, &asset.CommissioningDate, &asset.StationName, &asset.Technician, &asset.StartDate, &asset.EndDate, &asset.Service, &staffRaw, &asset.Latitude, &asset.Longitude, &asset.Pitch, &asset.Roll, &imagesRaw); err != nil {
			log.Printf("row scan failed: %v", err)
			continue
		}
		if staffRaw.Valid && staffRaw.String != "" {
			_ = json.Unmarshal([]byte(staffRaw.String), &asset.Staff)
		}
		if imagesRaw.Valid && imagesRaw.String != "" {
			_ = json.Unmarshal([]byte(imagesRaw.String), &asset.ImageURLs)
		}
		results = append(results, asset)
	}

	payload := map[string]interface{}{"data": results}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}
