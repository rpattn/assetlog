# Asset Log MVP Roadmap

## Current State
- The Asset Log page fetches asset records via `/api/plugins/rpatt-assetlog-app/resources/assets` and renders a read-only table without create, edit, or delete actions.​:codex-file-citation[codex-file-citation]{line_range_start=27 line_range_end=137 path=src/pages/PageOne.tsx git_url="https://github.com/rpattn/assetlog/blob/master/src/pages/PageOne.tsx#L27-L137"}​
- The backend only exposes a GET handler for `/assets`, enforcing org scoping but lacking mutation endpoints or attachment management.​:codex-file-citation[codex-file-citation]{line_range_start=28 line_range_end=89 path=pkg/plugin/handlers.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/handlers.go#L28-L89"}​
- Schema initialization creates a single `assets` table with a JSON-encoded `images` column; there is no table for attachment metadata or audit fields.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=88 path=data/init.sql git_url="https://github.com/rpattn/assetlog/blob/master/data/init.sql#L1-L88"}​
- Plugin configuration currently captures only an external API URL and key, so there is nowhere to store bucket settings or service account secrets yet.​:codex-file-citation[codex-file-citation]{line_range_start=9 line_range_end=140 path=src/components/AppConfig/AppConfig.tsx git_url="https://github.com/rpattn/assetlog/blob/master/src/components/AppConfig/AppConfig.tsx#L9-L140"}​

## MVP Goals
- Enable authenticated users to create, update, and delete asset log entries within their organization.
- Allow users to upload documents/images per log, store objects in a Google Cloud Storage bucket (configurable per plugin), and surface accessible URLs in Grafana.

## Roadmap Overview
### Phase 1 – Configuration & Storage Foundations
- Expand the configuration page to collect bucket name, optional path prefix, upload size limits, and a service account JSON secret using `SecretInput` alongside existing API settings.​:codex-file-citation[codex-file-citation]{line_range_start=24 line_range_end=105 path=src/components/AppConfig/AppConfig.tsx git_url="https://github.com/rpattn/assetlog/blob/master/src/components/AppConfig/AppConfig.tsx#L24-L105"}​
- Parse `backend.AppInstanceSettings.JSONData` and `DecryptedSecureJSONData` in `NewApp` so every handler can access validated storage settings; refresh the instance when config changes.​:codex-file-citation[codex-file-citation]{line_range_start=28 line_range_end=35 path=pkg/plugin/app.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/app.go#L28-L35"}​
- Add a storage client module (for example `pkg/plugin/storage.go`) that wraps Google Cloud Storage uploads/downloads, using bucket parameters from the parsed settings and supporting signed URL generation for read access.
- Surface configuration status through `CheckHealth`, returning warnings when the bucket or credentials are missing so operators can diagnose issues quickly.​:codex-file-citation[codex-file-citation]{line_range_start=46 line_range_end=55 path=pkg/plugin/app.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/app.go#L46-L55"}​

### Phase 2 – Database & API Enhancements
- Introduce migrations to add timestamp columns (`created_at`, `updated_at`) and a dedicated `asset_files` table keyed by `asset_id`, `org_id`, filename, content type, and GCS object name while migrating existing `images` JSON into the new structure.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=88 path=data/init.sql git_url="https://github.com/rpattn/assetlog/blob/master/data/init.sql#L1-L88"}​
- Update `registerRoutes` to register sub-routes such as `/assets/{id}` and `/assets/{id}/files` so each HTTP method can be dispatched cleanly.​:codex-file-citation[codex-file-citation]{line_range_start=65 line_range_end=82 path=pkg/plugin/resources.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/resources.go#L65-L82"}​
- Refactor `assetsHandler` into method-specific helpers (e.g., `listAssets`, `createAsset`, `updateAsset`, `deleteAsset`) that enforce org scoping, validate payloads, and wrap DB mutations inside transactions for consistency.​:codex-file-citation[codex-file-citation]{line_range_start=28 line_range_end=89 path=pkg/plugin/handlers.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/handlers.go#L28-L89"}​
- Add handlers for file management: a POST that accepts multipart uploads, streams objects to GCS via the storage client, and records metadata rows; a DELETE that removes both DB rows and GCS objects when a log entry or individual attachment is removed.

### Phase 3 – Frontend CRUD & Upload UX
- Replace the static table with stateful CRUD controls: an “Add log” button, inline edit actions, and delete confirmation prompts that call the new REST endpoints and optimistically update local state.​:codex-file-citation[codex-file-citation]{line_range_start=27 line_range_end=137 path=src/pages/PageOne.tsx git_url="https://github.com/rpattn/assetlog/blob/master/src/pages/PageOne.tsx#L27-L137"}​
- Create reusable form components (e.g., `AssetForm.tsx`, `AttachmentList.tsx`) with validation, default values, and spinner/alert feedback tied to request status.
- Integrate file uploads via `FormData`, showing upload progress and rendering thumbnail or download links using the URLs returned by the backend, falling back gracefully when the bucket is unconfigured.
- Add empty-state messaging that guides admins to configure the bucket before uploads are enabled, leveraging the same configuration flags surfaced in Phase 1.

### Phase 4 – QA, Observability & Launch
- Extend backend tests (`pkg/plugin/resources_test.go`) to cover CRUD success/error paths, org-isolation violations, and attachment upload/delete flows using a fake storage client.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=101 path=pkg/plugin/resources_test.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/resources_test.go#L1-L101"}​
- Add frontend Jest tests for the new forms and list interactions, mocking fetch to verify optimistic updates and error handling.
- Document setup in `README.md`, including required IAM roles (`storage.objects.create`, `storage.objects.delete`, `storage.objects.get`), Grafana configuration steps, and sample dashboards linking to attachments.
- Provide operational playbooks: log messages for storage failures, metrics or traces if available, and a data retention policy for cleaning orphaned files when assets are deleted.

## Implementation Guide
1. **Configuration UI & Types**
   1. Extend `AppPluginSettings` and `State` in `src/components/AppConfig/AppConfig.tsx` with fields for bucket name, object prefix, maximum upload size, and a `SecretInput` for the service account JSON; update form layout, validation, and `updatePluginAndReload` payload accordingly.​:codex-file-citation[codex-file-citation]{line_range_start=9 line_range_end=105 path=src/components/AppConfig/AppConfig.tsx git_url="https://github.com/rpattn/assetlog/blob/master/src/components/AppConfig/AppConfig.tsx#L9-L105"}​
   2. Update `testIds` and existing Jest specs to assert the new fields render and honor the disabled state when secrets are already configured.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=21 path=src/components/testIds.ts git_url="https://github.com/rpattn/assetlog/blob/master/src/components/testIds.ts#L1-L21"}​​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=37 path=src/components/AppConfig/AppConfig.test.tsx git_url="https://github.com/rpattn/assetlog/blob/master/src/components/AppConfig/AppConfig.test.tsx#L1-L37"}​

2. **Backend Configuration Loading**
   1. Define a struct such as `type StorageConfig struct { Bucket string; Prefix string; MaxSize int64; CredentialsJSON []byte }` in a new file (e.g., `pkg/plugin/config.go`) and parse it inside `NewApp`, using the provided `backend.AppInstanceSettings` value.​:codex-file-citation[codex-file-citation]{line_range_start=28 line_range_end=35 path=pkg/plugin/app.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/app.go#L28-L35"}​
   2. Store the parsed config on `App`, expose thread-safe getters, and adjust `Dispose` to release any storage client resources alongside the DB handle.​:codex-file-citation[codex-file-citation]{line_range_start=14 line_range_end=44 path=pkg/plugin/app.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/app.go#L14-L44"}​
   3. Add helper functions to validate required fields and emit meaningful errors that surface through Grafana’s plugin health check.

3. **Database Migration Layer**
   1. Replace the one-time `init.sql` load with a simple versioned migration runner that can apply new statements when the plugin starts; seed version `1` with the current schema and add migration `2` for the attachments table and timestamps.​:codex-file-citation[codex-file-citation]{line_range_start=13 line_range_end=44 path=pkg/plugin/database.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/database.go#L13-L44"}​​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=88 path=data/init.sql git_url="https://github.com/rpattn/assetlog/blob/master/data/init.sql#L1-L88"}​
   2. Write migration SQL that backfills existing `images` JSON into the new `asset_files` rows and clears the legacy column to prevent divergence.
   3. Create DAO helpers (e.g., `insertAsset`, `updateAsset`, `deleteAsset`, `listFilesByAsset`) to centralize SQL and ensure parameters are always bound by org ID.

4. **REST API Expansion**
   1. Refactor `registerRoutes` to add handlers for `/assets` (GET/POST) and `/assets/{id}` (PUT/DELETE) plus `/assets/{id}/files` (POST) and `/assets/{id}/files/{fileId}` (DELETE), reusing context-aware helpers to fetch the caller’s org ID.​:codex-file-citation[codex-file-citation]{line_range_start=65 line_range_end=82 path=pkg/plugin/resources.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/resources.go#L65-L82"}​
   2. Replace the existing monolithic `assetsHandler` with method-specific functions that decode request bodies into typed structs, validate fields (dates, coordinate ranges), and return structured JSON responses.​:codex-file-citation[codex-file-citation]{line_range_start=28 line_range_end=89 path=pkg/plugin/handlers.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/handlers.go#L28-L89"}​
   3. Implement file upload endpoints that accept multipart/form-data, enforce `MaxSize`, call the storage client, and persist metadata rows; respond with signed URLs or proxy endpoints so the frontend can render thumbnails without exposing raw object names.

5. **Frontend CRUD & Upload Workflows**
   1. Update `src/pages/PageOne.tsx` to manage asset collections with React Query or custom hooks, adding create/edit/delete handlers that call the new REST API and refresh state; ensure loading and error states remain accessible.​:codex-file-citation[codex-file-citation]{line_range_start=27 line_range_end=137 path=src/pages/PageOne.tsx git_url="https://github.com/rpattn/assetlog/blob/master/src/pages/PageOne.tsx#L27-L137"}​
   2. Introduce new components under `src/components/AssetForm/` for the modal or drawer UI, sharing validation logic (e.g., using `react-hook-form`) and presenting current attachments with delete buttons.
   3. Wire file inputs to the attachments endpoint using `fetch` with `FormData`, displaying progress bars, disabling submission during uploads, and updating the table row with the returned attachment metadata.
   4. Add localization-friendly copy for confirmation dialogs and error toasts, and ensure keyboard/screen-reader accessibility for the new controls.

6. **Testing, Tooling & Documentation**
   1. Expand `pkg/plugin/resources_test.go` with table-driven tests for every new handler, including failure cases (invalid payloads, missing config, org mismatches, storage errors) while using dependency injection to swap in an in-memory DB and mock storage client.​:codex-file-citation[codex-file-citation]{line_range_start=1 line_range_end=101 path=pkg/plugin/resources_test.go git_url="https://github.com/rpattn/assetlog/blob/master/pkg/plugin/resources_test.go#L1-L101"}​
   2. Create new frontend Jest tests covering the create/edit/delete flows and attachment UI, mocking the backend responses to assert optimistic updates and error fallback behavior.
   3. Update developer docs in `README.md` with setup instructions for Google Cloud (service account creation, bucket IAM, optional lifecycle policies) and Grafana configuration screenshots, plus a troubleshooting section for common error codes.
   4. Consider adding a lightweight e2e Playwright scenario that spins up the dev server, seeds fake storage, and exercises the full CRUD + upload path to guard against regressions.
