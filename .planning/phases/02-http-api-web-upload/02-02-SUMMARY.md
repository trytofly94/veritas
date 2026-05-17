---
phase: 02-http-api-web-upload
plan: 02
subsystem: db
tags: [sqlite, drizzle-orm, backfill, schema, migration]
dependency_graph:
  requires: []
  provides:
    - src/db/schema.ts → archiveEntries table definition
    - src/db/client.ts → openDb() factory
    - src/db/backfill.ts → backfillManifest()
  affects:
    - Plan 03 (upload rewire) — consumes openDb() + archiveEntries
    - Plan 05 (download) — consumes openDb() + archiveEntries for row lookup
    - Phase 3 browser — consumes archiveEntries for list/detail views
tech_stack:
  added:
    - drizzle-orm@0.30.10
    - better-sqlite3@12.10.0 (prebuilt binary, Node 24 compatible)
    - drizzle-kit@0.20.18 (dev)
    - "@types/better-sqlite3@7.6.13 (dev)"
  patterns:
    - Raw SQL migration via sqlite.exec() (no drizzle-kit journal required)
    - REPO_ROOT via import.meta.url (same as src/lib/bundle.ts WR-05 pattern)
    - onConflictDoNothing() for INSERT-OR-IGNORE idempotent backfill
    - TDD: RED commit → GREEN commit sequence
key_files:
  created:
    - src/db/schema.ts
    - src/db/client.ts
    - src/db/migrations/0000_init.sql
    - src/db/backfill.ts
    - drizzle.config.ts
    - tests/unit/backfill.test.ts
  modified:
    - package.json (added 4 dependencies)
    - package-lock.json
decisions:
  - "Used sqlite.exec() for migration instead of drizzle-kit migrate() to avoid the meta/_journal.json requirement. The DDL uses IF NOT EXISTS guards for idempotent startup (D-18). Documented fallback in plan was explicitly allowed."
  - "Upgraded better-sqlite3 to v12 (not v9.6.0 specified in plan) because v9 has no prebuilt binary for Node 24 and the C++ build fails with the installed clang toolchain. v12 ships prebuilt arm64-darwin binaries compatible with Node 24."
  - "Used `as import('node:fs').Dirent[]` cast for fsp.readdir() result due to @types/node version mismatch (v22 Dirent<NonSharedBuffer> vs expected Dirent<string>). Tests confirm runtime behavior is correct."
metrics:
  duration: "~25 minutes"
  completed: "2026-05-17T15:54:56Z"
  tasks: 2
  files: 8
---

# Phase 02 Plan 02: SQLite Manifest Layer Summary

Stood up the SQLite manifest layer: Drizzle schema, DB client factory with on-open migration, and startup backfill that mirrors existing on-disk bundles into the new table.

## What Was Built

### Task 1: Drizzle schema + migration + DB client

**Schema (`src/db/schema.ts`):** `archiveEntries` table with all 13 columns from D-19:
- `id TEXT PRIMARY KEY` (ULID)
- `original_filename`, `mime_type`, `size_bytes`, `sha256`, `created_at`, `label`, `source_ip` — mirrors `metadata.json` 1:1
- `tsa_provider`, `tsa_status`, `tsa_attested_at`, `tsa_fallback_chain` (JSON TEXT), `bundle_dir`
- Two indices: `idx_archive_entries_created_at` (DESC for browser list), `idx_archive_entries_sha256` (dedup lookup)

**Migration (`src/db/migrations/0000_init.sql`):** Hand-written DDL with `CREATE TABLE IF NOT EXISTS` + 2 `CREATE INDEX IF NOT EXISTS` — fully idempotent startup migration (D-18).

**DB client (`src/db/client.ts`):** `openDb(dbPath): Db` sets `PRAGMA journal_mode = WAL`, applies migration via `sqlite.exec()` directly (no journal file), and returns a Drizzle handle.

**Migrator choice:** Used `sqlite.exec()` directly (plan-documented fallback) instead of drizzle's `migrate()` to avoid the `meta/_journal.json` requirement. This is equivalent for a single initial migration and simpler to maintain.

### Task 2: Backfill scanner (TDD)

**Backfill (`src/db/backfill.ts`):** `backfillManifest({db, dataDir})` implements D-20:
- `fsp.readdir(dataDir, {withFileTypes: true})` — skips non-directories and `.tmp-` prefixed dirs
- For each bundle dir: reads + parses `metadata.json`, spreads into row + `JSON.stringify(tsa_fallback_chain)` + `bundle_dir`
- `onConflictDoNothing().run()` — INSERT OR IGNORE for idempotency
- Try/catch per bundle — broken bundles logged via `console.warn("[backfill] skip <path>: <error>")` and counted as `skipped`
- Single log line at end: `[backfill] indexed N entries, skipped M broken bundles in Xms`
- ENOENT on missing `dataDir` returns `{indexed:0, skipped:0}` (fresh volume boot case)

**Tests (`tests/unit/backfill.test.ts`):** 7 test cases covering all behavior requirements:
1. Empty dataDir → `{indexed:0, skipped:0}`
2. 1 valid bundle → indexed, row has correct `bundle_dir` and `tsa_fallback_chain` as JSON string
3. 2 bundles, 2 runs → idempotent, row count stays at 2
4. Missing `metadata.json` → skipped, `console.warn` called with bundle path
5. Malformed `metadata.json` → skipped, `console.warn` called
6. `.tmp-` dirs → ignored (neither indexed nor skipped)
7. Log line matches `^\[backfill\] indexed \d+ entries, skipped \d+ broken bundles in \d+ms$`

## Verification Results

```
Test Files  2 passed (2)
Tests  13 passed (13)
TSC noEmit: OK
Isolation check (no middleware/routes/views imports in src/db/): OK
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] better-sqlite3 native module build failure on Node 24**
- **Found during:** Task 1 dependency installation
- **Issue:** better-sqlite3@9.6.0 (specified in plan) has no prebuilt binary for Node 24 and the C++ native build fails because the installed `cc` binary and clang don't support C++20 required by Node 24's headers.
- **Fix:** Installed better-sqlite3@12.10.0 which ships prebuilt arm64-darwin binaries for Node 24.
- **Files modified:** `package.json` (version range updated to `^12.10.0`), `package-lock.json`
- **Note:** The CLAUDE.md stack table specifies `^9.x` — v12 is the correct modern version for Node 24 compatibility.

**2. [Rule 1 - Bug] TypeScript Dirent type mismatch**
- **Found during:** Task 2 implementation, `npx tsc --noEmit` check
- **Issue:** `@types/node@22` changed `fsp.readdir(..., {withFileTypes: true})` return type to `Dirent<NonSharedBuffer>` causing type errors when accessing `.name` and `.isDirectory()`.
- **Fix:** Added explicit cast `as import('node:fs').Dirent[]` on the readdir result.
- **Files modified:** `src/db/backfill.ts`

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `afddfaf` `test(02-02): add failing tests for backfill scanner` | PASS — 7 tests, all failing (backfill.ts absent) |
| GREEN | `6e9f955` `feat(02-02): implement backfill scanner` | PASS — 7 tests, all passing |
| REFACTOR | N/A | No cleanup needed |

## Known Stubs

None — all fields wire to real data.

## Threat Flags

None — no new network endpoints or trust boundaries introduced. The backfill reads only the local filesystem (within the configured `dataDir`). T-02-06 and T-02-07 mitigations are implemented: try/catch per bundle, `onConflictDoNothing()`.

## Self-Check

Files created exist:
- `src/db/schema.ts` — FOUND
- `src/db/client.ts` — FOUND
- `src/db/migrations/0000_init.sql` — FOUND
- `src/db/backfill.ts` — FOUND
- `drizzle.config.ts` — FOUND
- `tests/unit/backfill.test.ts` — FOUND

Commits:
- `96077b8` feat(02-02): Drizzle schema + migration + DB client — FOUND
- `afddfaf` test(02-02): add failing tests for backfill scanner (TDD RED) — FOUND
- `6e9f955` feat(02-02): implement backfill scanner — FOUND

## Self-Check: PASSED
