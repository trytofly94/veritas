---
type: quick-plan
slug: metadata-field-rename
date: 2026-05-17
---

# Fix metadata field-name mismatch in archive-detail.ts

The `ArchiveDetailMeta` interface in `src/views/archive-detail.ts` uses
`submitter_label` and `server_timestamp`, but `buildMetadata()` in
`src/lib/metadata.ts` (and the `Metadata` type in `src/types.ts`) writes
`label` and `created_at` to disk. The view currently renders empty strings
for those fields against a real metadata.json.

## Tasks

1. Rename in `src/views/archive-detail.ts`:
   - `ArchiveDetailMeta.submitter_label` → `label`
   - `ArchiveDetailMeta.server_timestamp` → `created_at`
   - All call sites (`meta.submitter_label` → `meta.label`,
     `meta.server_timestamp` → `meta.created_at`).
2. Update `tests/unit/archive-detail-view.test.ts` fixture + assertions
   to use the canonical names.
3. Add an integration test that feeds real `buildMetadata()` output
   through `renderArchiveDetailPage` to prevent fixture drift.
4. Run unit + typecheck.
