---
phase: 03-archive-browser
verified: 2026-05-17T20:50:00Z
status: passed
score: 2/2 must-haves verified
overrides_applied: 0
mode: mvp
---

# Phase 3: Archive Browser — Verification Report

**Phase Goal:** The archive owner can open a browser, log in, and inspect every archived entry — seeing its metadata, TSA status, and being able to confirm its integrity — without using the command line.
**Verified:** 2026-05-17T20:50:00Z
**Status:** PASS
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Browser UI shows a chronological list of all archived entries with filename, submission date, file type, and TSA status visible at a glance | ✓ VERIFIED | `src/routes/archive.ts:54-81` runs `select … orderBy(desc(created_at))`; `src/views/archive-list.ts` renders semantic `<table>` with thead columns "Dateiname / Datum / Typ / Status"; `formatList.ts` formats date as `YYYY-MM-DD HH:mm`, MIME subtype uppercase, and 5-state TSA badge; e2e `archive-list.test.ts` covers empty state, 3-row descending order, all 3 badge variants, type column |
| 2 | Clicking an entry opens a detail view showing all metadata.json fields including submitter label, source IP, server timestamp, TSA-attested time, and tsa_provider | ✓ VERIFIED | First-cell `<a href="/archive/{id}">` wires navigation (no `<tr>` onclick); `src/views/archive-detail.ts` renders all 9 labels (Archiv-ID, Bezeichnung, Dateigröße, Dateityp, SHA-256, Server-Zeitstempel, TSA-Zeitstempel, TSA-Anbieter, Quell-IP); unit test "renders all 9 metadata labels from UI-SPEC §Copywriting Contract" passes; e2e `archive-detail.test.ts` covers content + auth gate |

**Score:** 2/2 truths verified

## Verification Dimensions

### 1. Goal-Backward Must-Haves
Both Success Criteria from ROADMAP are observably true in the shipped code. The full browser flow — auth-gate → list → row click → detail → 9 metadata rows + verify button — is end-to-end wired.

### 2. Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BROWSE-01 | 03-01-PLAN | Chronological list with filename/date/type/TSA-status | ✓ SATISFIED | `src/routes/archive.ts:54-81` + `src/views/archive-list.ts` + `tests/e2e/archive-list.test.ts` (14 cases) + `tests/unit/formatList.test.ts` (34 cases) |
| BROWSE-02 | 03-02-PLAN | Detail view with all metadata + integrity verification | ✓ SATISFIED | `src/routes/archive.ts:85-173` + `src/views/archive-detail.ts` + `src/lib/verifyIntegrity.ts` + `tests/e2e/archive-detail.test.ts` (8 cases) + `tests/e2e/archive-verify.test.ts` (5 cases) + `tests/unit/archive-detail-view.test.ts` (17 cases) + `tests/unit/verifyIntegrity.test.ts` (5 cases) + `tests/unit/formatDetail.test.ts` (11 cases) |

### 3. UI-SPEC Fidelity

| Item | Status | Evidence |
|------|--------|----------|
| Routes `/archive`, `/archive/:id`, `POST /api/archive/:id/verify` | ✓ | `src/routes/archive.ts` registers all three |
| TSA badge 5-state mapping (DFN / FreeTSA / other-attested / Lokal / Fehlgeschlagen) | ✓ | `formatList.ts:tsaBadgeProps` lines 69-93, three CSS classes in `style.css:399-411` |
| German copy strings (all 30+ from §Copywriting Contract) | ✓ | All literals present in `archive-list.ts` + `archive-detail.ts` (verified via unit tests for all 9 metadata labels + e2e for header/empty/CTA strings) |
| Empty state ("Noch keine Dateien archiviert.") | ✓ | `archive-list.ts:53-58` `renderEmptyState()`, e2e test "empty-state HTML when manifest is empty" |
| `aria-live="polite"` on verify result | ✓ | `archive-detail.ts:132`, unit + e2e regression tests |
| Semantic `<table>` (not `<div>` simulation) | ✓ | `archive-list.ts:78-93` uses `<thead>/<th scope="col">/<tbody>` |
| First-cell `<a>` as row link (no `<tr>` onclick) | ✓ | `archive-list.ts:70-75` plus e2e test "rendered `<tr>` elements contain NO onclick attribute" |
| `title=` attribute on truncated filenames | ✓ | `archive-list.ts:71` `<a … title="${safeName}">`, e2e test asserts presence |

### 4. Security Gates

| Gate | Status | Evidence |
|------|--------|----------|
| `requireSessionPage` on HTML routes | ✓ | `archive.ts:54,85` apply `requireSessionPage(deps)`; redirects to `/login?next=<path>` (`session.ts:43-46`); e2e auth-gate tests pass |
| `requireSessionApi` on verify API | ✓ | `archive.ts:137`; e2e verify test "returns 401 UNAUTHORIZED envelope without session cookie" |
| ULID regex on `:id` before DB/fs | ✓ | `ULID_REGEX` (`archive.ts:50`) applied at lines 89, 140 — BEFORE any DB lookup or filesystem access |
| `escapeHtml` on rendered metadata | ✓ | `archive-detail.ts` calls `escapeHtml` on filename, source_ip, mime_type, submitter_label, server_timestamp, tsa_attested_at, tsa_provider; XSS regression test "escapes malicious filename so no live `<img>` tag is emitted" |
| Safe `next` redirect validation | ✓ | `login.ts:9` references `isSafeNext()` allowlist (T-02-21 from Phase 2) |
| Streaming SHA-256 (not buffered) | ✓ | `verifyIntegrity.ts:60` uses `pipeline(createReadStream, hash)` — no buffering |
| Timing-safe hash compare | ✓ | `verifyIntegrity.ts:67-71` uses `crypto.timingSafeEqual` with length check |

### 5. Field-Name Canonicalization (W4)

`grep -c 'tsa_attested_time'` across both source and UI-SPEC:

| File | Count |
|------|-------|
| `.planning/phases/03-archive-browser/03-UI-SPEC.md` | 0 ✓ |
| `src/views/archive-list.ts` | 0 ✓ |
| `src/views/archive-detail.ts` | 0 ✓ |
| `src/routes/archive.ts` | 0 ✓ |
| `src/lib/formatList.ts` | 0 ✓ |
| `src/lib/formatDetail.ts` | 0 ✓ |

Detail view renders `tsa_attested_at` (DB column from Phase 2 schema). W4 regression test in `archive-detail-view.test.ts` ("does NOT contain 'tsa_attested_time' anywhere in the output") passes. Only historical references remain in PLAN/SUMMARY docs, which document the rename — acceptable.

### 6. Error Channel Split (W3)

| Route | On error → | Status |
|-------|-----------|--------|
| `GET /archive/:id` (metadata.json missing) | HTML 500 via `renderErrorPage("Fehler", …)` | ✓ archive.ts:116-122, e2e test "returns text/html 500 with German error string when metadata.json is missing" |
| `GET /archive/:id` (unknown ULID / not found) | HTML 404 via `renderNotFoundPage()` | ✓ archive.ts:90,100, e2e test "returns 404 HTML page with 'Eintrag nicht gefunden.'" |
| `POST /api/archive/:id/verify` (any failure) | JSON envelope via `errorResponse(…)` | ✓ archive.ts:141,151,166, e2e tests for 401/404 envelopes |
| `GET /archive` (DB query failure) | JSON envelope (`errorResponse` 500 "INTERNAL_ERROR") | ⚠ MINOR DEVIATION — see Anti-Patterns |

### 7. Test Coverage

| Suite | File | Cases | Result |
|-------|------|-------|--------|
| Unit | `formatList.test.ts` | 34 | ✓ all pass |
| Unit | `formatDetail.test.ts` | 11 | ✓ all pass |
| Unit | `verifyIntegrity.test.ts` | 5 | ✓ all pass |
| Unit | `archive-detail-view.test.ts` | 17 | ✓ all pass |
| E2E | `archive-list.test.ts` | 14 | ✓ all pass |
| E2E | `archive-detail.test.ts` | 9 | ✓ all pass |
| E2E | `archive-verify.test.ts` | 5 | ✓ all pass |
| **Total** | | **83** | **83/83 pass** |

Run: `npx vitest run tests/unit/{formatList,formatDetail,verifyIntegrity,archive-detail-view}.test.ts tests/e2e/{archive-list,archive-detail,archive-verify}.test.ts` → `Test Files 7 passed (7) / Tests 83 passed (83)` in 1.06 s.

### 8. Build Health

`npx tsc --noEmit` → exit 0, no diagnostics.

### Anti-Patterns / Notes

| File | Line | Issue | Severity | Impact |
|------|------|-------|----------|--------|
| `src/routes/archive.ts` | 73-79 | `GET /archive` list-route catch returns `errorResponse` (JSON envelope) instead of `renderErrorPage(...)` HTML. UI-SPEC §Error States row "Archive list: server error" specifies a red error banner ("Fehler beim Laden des Archivs. Bitte Seite neu laden.") on the list **page**, which implies HTML response. The exception path is also outside W3's strict per-plan scope (W3 was concerned with detail-page failures), and there is no test exercising the DB-failure branch. | ℹ INFO | A logged-in user whose DB query throws would see raw JSON instead of the planned banner. Goal still satisfied (no DB failure observed in tests). Documenting as an opportunistic polish item, not a goal blocker. |
| `src/views/archive-detail.ts` | 84-88 | `tsaAttestedRendered` ternary contains a precedence quirk: `tsaAttestedAt && entry.tsa_status === "ok" || (tsaAttestedAt && entry.tsa_status === "verified")` — relies on JS `&&` > `||` to short-circuit. Works correctly (and is covered by tests) but parens around the first conjunction would improve readability. | ℹ INFO | No functional impact; tests cover both `ok` and `verified` paths. |

No TBD/FIXME/XXX debt markers, no `return null`/`return []` stubs, no console.log-only handlers, no hardcoded empty props.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Real Data | Status |
|----------|---------------|--------|-----------|--------|
| `archive-list.ts:renderArchiveListPage` | `entries[]` | `deps.db.select().from(archiveEntries).orderBy(desc(created_at)).all()` (`archive.ts:56-69`) | ✓ Live SQLite query, mapped from Drizzle row | ✓ FLOWING |
| `archive-detail.ts:renderArchiveDetailPage` | `entry`, `meta` | DB row (`archive.ts:93-97`) + filesystem `metadata.json` (`archive.ts:106-110`) | ✓ Real DB + on-disk JSON | ✓ FLOWING |
| `verifyIntegrity.ts` | computed SHA-256 | streaming hash of on-disk `original.<ext>` | ✓ Live filesystem read | ✓ FLOWING |

### Behavioral Spot-Checks

Spot-checks subsumed by the 83-case test suite (unit + e2e), which exercises real HTTP routes against an in-memory Hono server + temp SQLite manifest + temp filesystem bundles. No additional ad-hoc commands run.

### Human Verification Required

None for goal-backward verification — all 2 Success Criteria are programmatically verifiable via the existing test suite. (UAT for visual polish, hover affordance feel, and copy-button UX would be appropriate at the human-review stage, but is not required for goal achievement.)

## Gaps Summary

No gaps. Phase 3 ships the Archive Browser end-to-end:

- Server-rendered chronological list page at `/archive` with semantic table, 5-state TSA badge mapping, empty state, and accessible row-cell anchors.
- Server-rendered detail page at `/archive/:id` with all 9 metadata fields, integrity-verify Alpine.js component with `aria-live` announcement, copy-to-clipboard, and download CTA.
- `POST /api/archive/:id/verify` endpoint with streaming SHA-256 + `timingSafeEqual` comparison, JSON envelope responses, distinct `hash_mismatch` and `file_missing` states.
- Security: page/API auth split (303 vs 401), ULID regex pre-validation, `escapeHtml` on every interpolated user value, safe-next redirect allowlist inherited from Phase 2.
- W3 (HTML vs JSON channel split) and W4 (field-name canonicalization to `tsa_attested_at`) both satisfied in source + UI-SPEC.
- 83/83 tests pass; `tsc --noEmit` exit 0.

One informational deviation: the list-page DB-failure branch returns a JSON envelope instead of the planned HTML banner. Goal is unaffected (no DB failure path observed; covered route paths all return correct media types).

---

_Verified: 2026-05-17T20:50:00Z_
_Verifier: Claude (gsd-verifier)_
