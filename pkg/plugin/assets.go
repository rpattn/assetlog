package plugin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

type validationError struct {
	message string
}

func (e validationError) Error() string {
	return e.message
}

var (
	errAssetNotFound     = errors.New("asset not found")
	errAssetFileNotFound = errors.New("asset file not found")
)

const (
	defaultAssetsPageSize = 25
	maxAssetsPageSize     = 200
)

const emptyFilterValue = "__EMPTY__"

var assetFilterColumns = map[string]string{
	"title":              "title",
	"entry_date":         "entry_date",
	"commissioning_date": "commissioning_date",
	"station_name":       "station_name",
	"technician":         "technician",
	"service":            "service",
}

var assetSortColumns = map[string]string{
	"title":              "title",
	"entry_date":         "entry_date",
	"commissioning_date": "commissioning_date",
	"station_name":       "station_name",
	"technician":         "technician",
	"service":            "service",
	"start_date":         "start_date",
	"end_date":           "end_date",
}

type AssetSortDirection string

const (
	sortDirectionAsc  AssetSortDirection = "asc"
	sortDirectionDesc AssetSortDirection = "desc"
)

type AssetListSort struct {
	Key       string             `json:"key"`
	Direction AssetSortDirection `json:"direction"`
	column    string             `json:"-"`
}

type AssetRecord struct {
	ID                int64       `json:"id"`
	Title             string      `json:"title"`
	EntryDate         string      `json:"entry_date"`
	CommissioningDate string      `json:"commissioning_date"`
	StationName       string      `json:"station_name"`
	Technician        string      `json:"technician"`
	StartDate         string      `json:"start_date"`
	EndDate           string      `json:"end_date"`
	Service           string      `json:"service,omitempty"`
	Staff             []string    `json:"staff"`
	Latitude          float64     `json:"latitude"`
	Longitude         float64     `json:"longitude"`
	Pitch             float64     `json:"pitch"`
	Roll              float64     `json:"roll"`
	Attachments       []AssetFile `json:"attachments"`
	ImageURLs         []string    `json:"image_urls,omitempty"`
	CreatedAt         string      `json:"created_at"`
	UpdatedAt         string      `json:"updated_at"`
}

type AssetFile struct {
	ID          int64  `json:"id"`
	AssetID     int64  `json:"asset_id"`
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type,omitempty"`
	URL         string `json:"url,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	storageKey  string
}

type AssetPayload struct {
	Title             string   `json:"title"`
	EntryDate         string   `json:"entry_date"`
	CommissioningDate string   `json:"commissioning_date"`
	StationName       string   `json:"station_name"`
	Technician        string   `json:"technician"`
	StartDate         string   `json:"start_date"`
	EndDate           string   `json:"end_date"`
	Service           string   `json:"service"`
	Staff             []string `json:"staff"`
	Latitude          float64  `json:"latitude"`
	Longitude         float64  `json:"longitude"`
	Pitch             float64  `json:"pitch"`
	Roll              float64  `json:"roll"`
}

func (p *AssetPayload) normalize() {
	p.Title = strings.TrimSpace(p.Title)
	p.EntryDate = strings.TrimSpace(p.EntryDate)
	p.CommissioningDate = strings.TrimSpace(p.CommissioningDate)
	p.StationName = strings.TrimSpace(p.StationName)
	p.Technician = strings.TrimSpace(p.Technician)
	p.StartDate = strings.TrimSpace(p.StartDate)
	p.EndDate = strings.TrimSpace(p.EndDate)
	p.Service = strings.TrimSpace(p.Service)
	if p.Staff == nil {
		p.Staff = []string{}
	} else {
		for i, member := range p.Staff {
			p.Staff[i] = strings.TrimSpace(member)
		}
	}
}

func (p AssetPayload) validate() error {
	switch {
	case p.Title == "":
		return validationError{message: "title is required"}
	case p.EntryDate == "":
		return validationError{message: "entry_date is required"}
	case p.CommissioningDate == "":
		return validationError{message: "commissioning_date is required"}
	case p.StationName == "":
		return validationError{message: "station_name is required"}
	case p.Technician == "":
		return validationError{message: "technician is required"}
	case p.StartDate == "":
		return validationError{message: "start_date is required"}
	case p.EndDate == "":
		return validationError{message: "end_date is required"}
	}

	if math.Abs(p.Latitude) > 90 {
		return validationError{message: "latitude must be between -90 and 90"}
	}
	if math.Abs(p.Longitude) > 180 {
		return validationError{message: "longitude must be between -180 and 180"}
	}

	return nil
}

type AssetListOptions struct {
	Page     int
	PageSize int
	Filters  map[string][]string
	Sort     *AssetListSort
}

type AssetListResult struct {
	Records        []AssetRecord
	TotalCount     int64
	Page           int
	PageSize       int
	PageCount      int
	AppliedFilters map[string][]string
	AppliedSort    *AssetListSort
}

func (opts *AssetListOptions) normalize() {
	if opts.Page <= 0 {
		opts.Page = 1
	}
	if opts.PageSize <= 0 {
		opts.PageSize = defaultAssetsPageSize
	}
	if opts.PageSize > maxAssetsPageSize {
		opts.PageSize = maxAssetsPageSize
	}
	if opts.Filters == nil {
		opts.Filters = map[string][]string{}
	}
	if opts.Sort != nil {
		key := strings.TrimSpace(opts.Sort.Key)
		direction := strings.ToLower(strings.TrimSpace(string(opts.Sort.Direction)))
		column, ok := assetSortColumns[key]
		if !ok {
			opts.Sort = nil
		} else {
			switch direction {
			case string(sortDirectionAsc):
				opts.Sort.Direction = sortDirectionAsc
			case string(sortDirectionDesc):
				opts.Sort.Direction = sortDirectionDesc
			default:
				opts.Sort = nil
			}
			if opts.Sort != nil {
				opts.Sort.Key = key
				opts.Sort.column = column
			}
		}
	}
}

func (a *App) listAssets(ctx context.Context, orgID int64, opts AssetListOptions) (AssetListResult, error) {
	opts.normalize()

	whereParts := []string{"org_id = ?"}
	args := []interface{}{orgID}
	appliedFilters := make(map[string][]string)

	for key, values := range opts.Filters {
		column, ok := assetFilterColumns[key]
		if !ok {
			continue
		}
		includeEmpty := false
		cleaned := make([]string, 0, len(values))
		for _, raw := range values {
			trimmed := strings.TrimSpace(raw)
			if trimmed == "" {
				continue
			}
			if trimmed == emptyFilterValue {
				includeEmpty = true
				continue
			}
			cleaned = append(cleaned, trimmed)
		}
		if len(cleaned) == 0 && !includeEmpty {
			continue
		}
		sort.Strings(cleaned)
		conditions := make([]string, 0, 2)
		switch len(cleaned) {
		case 0:
			// no explicit values
		case 1:
			conditions = append(conditions, fmt.Sprintf("%s = ?", column))
			args = append(args, cleaned[0])
		default:
			placeholders := strings.TrimRight(strings.Repeat("?,", len(cleaned)), ",")
			conditions = append(conditions, fmt.Sprintf("%s IN (%s)", column, placeholders))
			for _, value := range cleaned {
				args = append(args, value)
			}
		}
		if includeEmpty {
			conditions = append(conditions, fmt.Sprintf("(%s IS NULL OR %s = '')", column, column))
		}
		if len(conditions) == 0 {
			continue
		}
		if len(conditions) == 1 {
			whereParts = append(whereParts, conditions[0])
		} else {
			whereParts = append(whereParts, fmt.Sprintf("(%s)", strings.Join(conditions, " OR ")))
		}
		applied := append([]string{}, cleaned...)
		if includeEmpty {
			applied = append(applied, emptyFilterValue)
		}
		appliedFilters[key] = applied
	}

	whereClause := strings.Join(whereParts, " AND ")

	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM assets WHERE %s`, whereClause)
	var total int64
	if err := a.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return AssetListResult{}, err
	}

	page := opts.Page
	if total > 0 {
		maxPage := int((total + int64(opts.PageSize) - 1) / int64(opts.PageSize))
		if page > maxPage {
			page = maxPage
		}
	} else {
		page = 1
	}

	offset := (page - 1) * opts.PageSize
	queryArgs := append(append([]interface{}{}, args...), opts.PageSize, offset)

	orderParts := make([]string, 0, 2)
	if opts.Sort != nil {
		direction := "ASC"
		if opts.Sort.Direction == sortDirectionDesc {
			direction = "DESC"
		}
		orderParts = append(orderParts, fmt.Sprintf("%s %s", opts.Sort.column, direction))
	} else {
		orderParts = append(orderParts, "entry_date DESC")
	}
	orderParts = append(orderParts, "id DESC")
	orderClause := strings.Join(orderParts, ", ")

	rows, err := a.db.QueryContext(ctx, fmt.Sprintf(`SELECT id, title, entry_date, commissioning_date, station_name, technician, start_date, end_date, service, staff, latitude, longitude, pitch, roll, created_at, updated_at FROM assets WHERE %s ORDER BY %s LIMIT ? OFFSET ?`, whereClause, orderClause), queryArgs...)
	if err != nil {
		return AssetListResult{}, err
	}
	defer rows.Close()

	var assets []AssetRecord
	var assetIDs []int64
	for rows.Next() {
		var record AssetRecord
		var service sqlNullString
		var staffRaw sqlNullString
		if err := rows.Scan(&record.ID, &record.Title, &record.EntryDate, &record.CommissioningDate, &record.StationName, &record.Technician, &record.StartDate, &record.EndDate, &service, &staffRaw, &record.Latitude, &record.Longitude, &record.Pitch, &record.Roll, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return AssetListResult{}, err
		}
		if service.Valid {
			record.Service = service.String
		}
		if staffRaw.Valid && strings.TrimSpace(staffRaw.String) != "" {
			_ = json.Unmarshal([]byte(staffRaw.String), &record.Staff)
		} else {
			record.Staff = []string{}
		}
		assets = append(assets, record)
		assetIDs = append(assetIDs, record.ID)
	}
	if err := rows.Err(); err != nil {
		return AssetListResult{}, err
	}

	attachments, err := a.loadAssetFiles(ctx, orgID, assetIDs)
	if err != nil {
		return AssetListResult{}, err
	}

	for i, asset := range assets {
		if files, ok := attachments[asset.ID]; ok {
			assets[i].Attachments = files
			assets[i].ImageURLs = collectFileNames(files)
		} else {
			assets[i].Attachments = []AssetFile{}
			assets[i].ImageURLs = []string{}
		}
		if assets[i].Staff == nil {
			assets[i].Staff = []string{}
		}
	}

	pageCount := 0
	if total > 0 {
		pageCount = int((total + int64(opts.PageSize) - 1) / int64(opts.PageSize))
	}

	var appliedSort *AssetListSort
	if opts.Sort != nil {
		appliedSort = &AssetListSort{Key: opts.Sort.Key, Direction: opts.Sort.Direction}
	}

	return AssetListResult{
		Records:        assets,
		TotalCount:     total,
		Page:           page,
		PageSize:       opts.PageSize,
		PageCount:      pageCount,
		AppliedFilters: appliedFilters,
		AppliedSort:    appliedSort,
	}, nil
}

func (a *App) getAsset(ctx context.Context, orgID, assetID int64) (AssetRecord, error) {
	var record AssetRecord
	var service sqlNullString
	var staffRaw sqlNullString
	err := a.db.QueryRowContext(ctx, `SELECT id, title, entry_date, commissioning_date, station_name, technician, start_date, end_date, service, staff, latitude, longitude, pitch, roll, created_at, updated_at FROM assets WHERE org_id = ? AND id = ?`, orgID, assetID).Scan(
		&record.ID,
		&record.Title,
		&record.EntryDate,
		&record.CommissioningDate,
		&record.StationName,
		&record.Technician,
		&record.StartDate,
		&record.EndDate,
		&service,
		&staffRaw,
		&record.Latitude,
		&record.Longitude,
		&record.Pitch,
		&record.Roll,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return AssetRecord{}, errAssetNotFound
	}
	if err != nil {
		return AssetRecord{}, err
	}
	if service.Valid {
		record.Service = service.String
	}
	if staffRaw.Valid && strings.TrimSpace(staffRaw.String) != "" {
		_ = json.Unmarshal([]byte(staffRaw.String), &record.Staff)
	} else {
		record.Staff = []string{}
	}

	files, err := a.loadAssetFiles(ctx, orgID, []int64{record.ID})
	if err != nil {
		return AssetRecord{}, err
	}
	if attachments, ok := files[record.ID]; ok {
		record.Attachments = attachments
		record.ImageURLs = collectFileNames(attachments)
	} else {
		record.Attachments = []AssetFile{}
		record.ImageURLs = []string{}
	}
	return record, nil
}

func (a *App) createAsset(ctx context.Context, orgID int64, payload AssetPayload) (AssetRecord, error) {
	payload.normalize()
	if err := payload.validate(); err != nil {
		return AssetRecord{}, err
	}

	staffJSON, err := json.Marshal(payload.Staff)
	if err != nil {
		return AssetRecord{}, fmt.Errorf("marshal staff: %w", err)
	}

	var serviceValue interface{}
	if payload.Service != "" {
		serviceValue = payload.Service
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := a.db.ExecContext(ctx, `INSERT INTO assets (org_id, title, entry_date, commissioning_date, station_name, technician, start_date, end_date, service, staff, latitude, longitude, pitch, roll, images, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		orgID,
		payload.Title,
		payload.EntryDate,
		payload.CommissioningDate,
		payload.StationName,
		payload.Technician,
		payload.StartDate,
		payload.EndDate,
		serviceValue,
		string(staffJSON),
		payload.Latitude,
		payload.Longitude,
		payload.Pitch,
		payload.Roll,
		"[]",
		now,
		now,
	)
	if err != nil {
		return AssetRecord{}, err
	}

	assetID, err := res.LastInsertId()
	if err != nil {
		return AssetRecord{}, err
	}

	return a.getAsset(ctx, orgID, assetID)
}

func (a *App) updateAsset(ctx context.Context, orgID, assetID int64, payload AssetPayload) (AssetRecord, error) {
	payload.normalize()
	if err := payload.validate(); err != nil {
		return AssetRecord{}, err
	}

	staffJSON, err := json.Marshal(payload.Staff)
	if err != nil {
		return AssetRecord{}, fmt.Errorf("marshal staff: %w", err)
	}

	var serviceValue interface{}
	if payload.Service != "" {
		serviceValue = payload.Service
	}

	res, err := a.db.ExecContext(ctx, `UPDATE assets SET title = ?, entry_date = ?, commissioning_date = ?, station_name = ?, technician = ?, start_date = ?, end_date = ?, service = ?, staff = ?, latitude = ?, longitude = ?, pitch = ?, roll = ?, images = '[]', updated_at = CURRENT_TIMESTAMP WHERE org_id = ? AND id = ?`,
		payload.Title,
		payload.EntryDate,
		payload.CommissioningDate,
		payload.StationName,
		payload.Technician,
		payload.StartDate,
		payload.EndDate,
		serviceValue,
		string(staffJSON),
		payload.Latitude,
		payload.Longitude,
		payload.Pitch,
		payload.Roll,
		orgID,
		assetID,
	)
	if err != nil {
		return AssetRecord{}, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return AssetRecord{}, err
	}
	if affected == 0 {
		return AssetRecord{}, errAssetNotFound
	}

	return a.getAsset(ctx, orgID, assetID)
}

func (a *App) deleteAsset(ctx context.Context, orgID, assetID int64) error {
	if a.storageConfigured() {
		attachments, err := a.loadAssetFiles(ctx, orgID, []int64{assetID})
		if err != nil {
			return err
		}
		if files, ok := attachments[assetID]; ok {
			for _, file := range files {
				if err := a.storage.Delete(ctx, file.storageKey); err != nil {
					return err
				}
			}
		}
	}

	res, err := a.db.ExecContext(ctx, `DELETE FROM assets WHERE org_id = ? AND id = ?`, orgID, assetID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errAssetNotFound
	}
	return nil
}

func (a *App) insertAssetFile(ctx context.Context, orgID, assetID int64, fileName, contentType, storageKey string) (AssetFile, error) {
	var contentValue interface{}
	if strings.TrimSpace(contentType) != "" {
		contentValue = contentType
	}
	res, err := a.db.ExecContext(ctx, `INSERT INTO asset_files (asset_id, org_id, file_name, content_type, object_name) VALUES (?, ?, ?, ?, ?)`,
		assetID,
		orgID,
		fileName,
		contentValue,
		storageKey,
	)
	if err != nil {
		return AssetFile{}, err
	}
	fileID, err := res.LastInsertId()
	if err != nil {
		return AssetFile{}, err
	}
	return a.getAssetFile(ctx, orgID, assetID, fileID)
}

func (a *App) getAssetFile(ctx context.Context, orgID, assetID, fileID int64) (AssetFile, error) {
	var file AssetFile
	var contentType sqlNullString
	err := a.db.QueryRowContext(ctx, `SELECT id, asset_id, file_name, content_type, object_name, created_at, updated_at FROM asset_files WHERE org_id = ? AND asset_id = ? AND id = ?`,
		orgID,
		assetID,
		fileID,
	).Scan(&file.ID, &file.AssetID, &file.FileName, &contentType, &file.storageKey, &file.CreatedAt, &file.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AssetFile{}, errAssetFileNotFound
	}
	if err != nil {
		return AssetFile{}, err
	}
	if contentType.Valid {
		file.ContentType = contentType.String
	}
	a.assignFileURL(ctx, &file)
	return file, nil
}

func (a *App) deleteAssetFile(ctx context.Context, orgID, assetID, fileID int64) error {
	file, err := a.getAssetFile(ctx, orgID, assetID, fileID)
	if err != nil {
		return err
	}
	if a.storageConfigured() && file.storageKey != "" {
		if err := a.storage.Delete(ctx, file.storageKey); err != nil {
			return err
		}
	}
	res, err := a.db.ExecContext(ctx, `DELETE FROM asset_files WHERE org_id = ? AND asset_id = ? AND id = ?`, orgID, assetID, fileID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return errAssetFileNotFound
	}
	return nil
}

func (a *App) generateStorageKey(orgID, assetID int64, fileName string) string {
	sanitized := sanitizeObjectName(fileName)
	if sanitized == "" {
		sanitized = fmt.Sprintf("file-%s", uuid.NewString())
	}
	timestamp := time.Now().UTC().Format("20060102T150405Z")
	unique := uuid.NewString()
	parts := []string{
		fmt.Sprintf("org-%d", orgID),
		fmt.Sprintf("asset-%d", assetID),
		fmt.Sprintf("%s-%s", timestamp, unique),
		sanitized,
	}
	return strings.Join(parts, "/")
}

func (a *App) ensureAssetExists(ctx context.Context, orgID, assetID int64) error {
	var id int64
	err := a.db.QueryRowContext(ctx, `SELECT id FROM assets WHERE org_id = ? AND id = ?`, orgID, assetID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return errAssetNotFound
	}
	return err
}

func (a *App) loadAssetFiles(ctx context.Context, orgID int64, assetIDs []int64) (map[int64][]AssetFile, error) {
	result := make(map[int64][]AssetFile)
	if len(assetIDs) == 0 {
		return result, nil
	}

	placeholders := make([]string, len(assetIDs))
	args := make([]interface{}, 0, len(assetIDs)+1)
	args = append(args, orgID)
	for i, id := range assetIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}

	query := fmt.Sprintf(`SELECT id, asset_id, file_name, content_type, object_name, created_at, updated_at FROM asset_files WHERE org_id = ? AND asset_id IN (%s) ORDER BY id`, strings.Join(placeholders, ","))
	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var file AssetFile
		var contentType sqlNullString
		if err := rows.Scan(&file.ID, &file.AssetID, &file.FileName, &contentType, &file.storageKey, &file.CreatedAt, &file.UpdatedAt); err != nil {
			return nil, err
		}
		if contentType.Valid {
			file.ContentType = contentType.String
		}
		a.assignFileURL(ctx, &file)
		result[file.AssetID] = append(result[file.AssetID], file)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func collectFileNames(files []AssetFile) []string {
	if len(files) == 0 {
		return []string{}
	}
	names := make([]string, 0, len(files))
	for _, f := range files {
		if strings.TrimSpace(f.FileName) != "" {
			names = append(names, f.FileName)
		}
	}
	return names
}

func (a *App) assignFileURL(ctx context.Context, file *AssetFile) {
	if file == nil || file.storageKey == "" {
		return
	}
	if !a.storageConfigured() {
		return
	}
	url, err := a.storage.SignedURL(ctx, file.storageKey, signedURLTTL)
	if err != nil {
		log.Printf("signed URL for %s failed: %v", file.storageKey, err)
		return
	}
	file.URL = url
}
