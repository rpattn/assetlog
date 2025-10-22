ALTER TABLE app_settings ADD COLUMN provisioned_json_data TEXT;
ALTER TABLE app_settings ADD COLUMN provisioned_secure_json_data TEXT;
ALTER TABLE app_settings ADD COLUMN provisioned_updated_at TEXT;

UPDATE app_settings
SET provisioned_json_data = json_data,
    provisioned_secure_json_data = secure_json_data,
    provisioned_updated_at = updated_at
WHERE provisioned_json_data IS NULL;
