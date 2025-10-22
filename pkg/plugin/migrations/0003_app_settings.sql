CREATE TABLE IF NOT EXISTS app_settings (
    org_id INTEGER PRIMARY KEY,
    json_data TEXT NOT NULL,
    secure_json_data TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

