ALTER TABLE assets ADD COLUMN created_at TEXT;
ALTER TABLE assets ADD COLUMN updated_at TEXT;

UPDATE assets
SET created_at = COALESCE(created_at, datetime('now')),
    updated_at = COALESCE(updated_at, datetime('now'));

CREATE TABLE IF NOT EXISTS asset_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT,
    object_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_files_asset_id ON asset_files(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_files_org_id ON asset_files(org_id);

INSERT INTO asset_files (asset_id, org_id, file_name, object_name, created_at, updated_at)
SELECT a.id,
       a.org_id,
       json_each.value AS file_name,
       json_each.value AS object_name,
       COALESCE(a.created_at, CURRENT_TIMESTAMP),
       COALESCE(a.updated_at, CURRENT_TIMESTAMP)
FROM assets AS a,
     json_each(a.images)
WHERE a.images IS NOT NULL
  AND a.images NOT IN ('', '[]');

UPDATE assets SET images = '[]' WHERE images IS NOT NULL AND images <> '[]';
