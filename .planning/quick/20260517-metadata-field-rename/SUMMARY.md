---
type: quick-summary
slug: metadata-field-rename
date: 2026-05-17
status: complete
---

# Summary — metadata field-name rename

## Changes

- `src/views/archive-detail.ts`: renamed `ArchiveDetailMeta.submitter_label` → `label`,
  `server_timestamp` → `created_at`. Updated all three call sites.
- `tests/unit/archive-detail-view.test.ts`: updated fixture + the empty-label test
  to use the canonical field names.
- Added integration test that builds a real `Metadata` object via `buildMetadata()`
  and feeds it through `renderArchiveDetailPage` — guards against future drift
  between writer and renderer field names.

## Verification

- `npx tsc --noEmit` — clean
- `npx vitest run tests/unit` — 100/100 passed (was 99 before; +1 integration test)
