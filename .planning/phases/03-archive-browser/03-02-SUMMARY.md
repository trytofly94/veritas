---
phase: 03-archive-browser
plan: "02"
subsystem: archive-browser
tags: [archive-browser, detail, integrity-verify, mvp-slice, alpine, hono, session-auth, sha256, ui-spec, browse-02]
requires:
  - phase-03/03-01 (registerArchive registrar, tsaBadgeProps, escapeHtml pattern, Phase 3 CSS)
  - phase-02/session-cookie-middleware (requireSessionPage, requireSessionApi)
  - phase-02/archive_entries-schema (Drizzle row shape, tsa_attested_at column)
  - phase-02/hash-streaming (createHash + pipeline pattern from sha256OfFile)
provides:
  - GET /archive/:id (auth-gated detail page, HTML errors)
  - POST /api/archive/:id/verify (auth-gated integrity check, JSON envelope)
  - renderArchiveDetailPage / renderNotFoundPage views
  - renderErrorPage view (HTML 500 helper for page endpoints)
  - formatBytes + truncateSha formatters
  - verifyBundleIntegrity library (streaming SHA-256 + timingSafeEqual)
  - escapeHtml shared helper (extracted from archive-list.ts pattern)
  - Alpine factories window.verifyIntegrity + window.copyState
  - Phase 3 detail-page CSS block (.archive-detail-page, .btn--ghost, .verify-result*)
affects:
  - src/routes/archive.ts (extended, not new — appended two routes + imports)
  - .planning/phases/03-archive-browser/03-UI-SPEC.md (W4 field-name patch)
tech-stack:
  added: []
  patterns:
    - "Page-vs-API auth split: requireSessionPage for HTML routes (303 redirect, HTML errors via renderErrorPage), requireSessionApi for JSON routes (401 envelope, errorResponse JSON)"
    - "HTML 500 for page-context failures (renderErrorPage) — no JSON envelope leakage to browser (plan-checker W3)"
    - "Streaming SHA-256 via createReadStream + crypto.createHash + pipeline (constant memory)"
    - "timingSafeEqual as defense-in-depth on hash comparison (T-03-17)"
    - "Path-traversal containment via path.extname() — adversarial originalFilename cannot escape bundleDir"
    - "ULID regex pre-check BEFORE any DB or fs access (T-03-10) — applied twice, once per route"
    - "Alpine x-data factories on window.* (no module imports, matches Phase 2 upload.js pattern)"
    - "Copy-to-clipboard via data-value attribute + 2000ms textContent revert (Phase 2 copyId pattern)"
key-files:
  created:
    - src/lib/formatDetail.ts
    - src/lib/verifyIntegrity.ts
    - src/lib/escapeHtml.ts
    - src/views/archive-detail.ts
    - src/views/error-page.ts
    - src/static/archive-detail.js
    - tests/unit/formatDetail.test.ts
    - tests/unit/verifyIntegrity.test.ts
    - tests/unit/archive-detail-view.test.ts
    - tests/e2e/archive-detail.test.ts
    - tests/e2e/archive-verify.test.ts
  modified:
    - src/routes/archive.ts
    - src/static/style.css
    - .planning/phases/03-archive-browser/03-UI-SPEC.md
decisions:
  - "Page-vs-API error channels split (plan-checker W3): GET /archive/:id failure paths use renderErrorPage (HTML 500) / renderNotFoundPage (HTML 404). The errorResponse JSON envelope is reserved for POST /api/archive/:id/verify."
  - "Canonicalized TSA-attested timestamp field name to tsa_attested_at across UI-SPEC, view, and tests (plan-checker W4). DB column wins."
  - "formatBytes uses base 1024 (not 1000) — UI-SPEC fixture values (186777 → 182,4 kB; 5e9 → 4,7 GB) only match base-1024; plan docstring corrected in-file."
  - "Extracted escapeHtml to src/lib/escapeHtml.ts (shared helper) rather than re-import from archive-list.ts — single source of truth for HTML escaping across all views."
  - "Alpine factories registered both on window.* AND via Alpine.data() in alpine:init — matches the existing upload.js convention; window.* keeps x-data attribute references simple."
  - "Copy buttons carry the full value in data-value attribute; copyValue reads from ev.target.dataset.value at click time (no closure over component state)."
  - "TSA badge re-uses tsaBadgeProps from 03-01 with no changes; 5-state mapping (DFN/FreeTSA/Lokal/Custom/Fehlgeschlagen) propagates verbatim to the detail page."
metrics:
  duration_min: 8
  completed: 2026-05-17
  tasks: 3
  files_changed: 13
  unit_tests_added: 32
  e2e_tests_added: 14
---

# Phase 03 Plan 02: Archive detail page + integrity verify Summary

Server-rendered detail page at `/archive/:id` showing every metadata field per UI-SPEC §Component Inventory #3, plus an Alpine-driven `POST /api/archive/:id/verify` endpoint that re-hashes the on-disk file via streaming SHA-256 and reports match/mismatch/missing. Closes BROWSE-02 end-to-end.

## What was built

1. **Pure formatters (`src/lib/formatDetail.ts`)** — two functions:
   - `formatBytes(n)` → German-locale humanized size string using base 1024 + `Intl.NumberFormat('de-DE')` with one fractional digit. Matches UI-SPEC fixtures: `186777 → "182,4 kB"`, `2_200_000 → "2,1 MB"`, `5_000_000_000 → "4,7 GB"`.
   - `truncateSha(hex)` → 16-char prefix + horizontal ellipsis (U+2026); empty input → em-dash placeholder; short input passed through unchanged.

2. **Integrity-verify library (`src/lib/verifyIntegrity.ts`)** — `verifyBundleIntegrity({ bundleDir, expectedSha256, originalFilename })` returns `{ok:true}` / `{ok:false, reason:'hash_mismatch'}` / `{ok:false, reason:'file_missing'}`. Streams the file through `crypto.createHash("sha256")` via `pipeline(createReadStream(...), hash)`; compares with `timingSafeEqual` as defense-in-depth. Path is built as `path.join(bundleDir, "original" + path.extname(originalFilename))` so adversarial filenames cannot escape the bundle.

3. **Shared escape helper (`src/lib/escapeHtml.ts`)** — attribute-safe HTML escape (`& < > " '`) extracted from the archive-list view pattern so all views can import it.

4. **Error-page view (`src/views/error-page.ts`, plan-checker W3)** — `renderErrorPage(title, message)` returns a full `<!doctype html>` document mirroring the detail-page shell, with the message inside an `.empty-state` block and a `← Zurück zum Archiv` link. No `<script>` tags so the page renders even when JS fails. The status code is set by the caller (`c.html(..., 500)`).

5. **Detail-page view (`src/views/archive-detail.ts`)** — `renderArchiveDetailPage({entry, meta})` renders the page exactly per UI-SPEC §Component Inventory #3 + §Integrity Verification Component + §Copywriting Contract:
   - Back link, filename h1, inline TSA badge + server timestamp.
   - First card: 9 metadata rows (Archiv-ID, Bezeichnung, Dateigröße, Dateityp, SHA-256, Server-Zeitstempel, TSA-Zeitstempel, TSA-Anbieter, Quell-IP) with copy buttons on Archiv-ID and SHA-256.
   - Second card: integrity-verify component with `x-data="verifyIntegrity('<id>')"`, button label that flips between "Integrität jetzt prüfen" and "Integrität wird geprüft …", and an `aria-live="polite"` result region rendering one of three states (ok / fail / error) per UI-SPEC verbatim German copy.
   - Full-width download CTA `<a class="btn btn--primary" href="/api/download/:id">Archiv-Bundle herunterladen</a>`.
   - `renderNotFoundPage()` covers both invalid-ULID and unknown-ULID cases with the verbatim "Eintrag nicht gefunden." copy.

6. **Alpine component (`src/static/archive-detail.js`)** — two factories:
   - `window.verifyIntegrity(archiveId)` — POSTs to `/api/archive/:id/verify` with `credentials: 'same-origin'`, maps the JSON `{ok}` to state `'ok'` or `'fail'`; HTTP non-2xx or network error → state `'error'`.
   - `window.copyState()` — `copyValue(value, ev)` writes to `navigator.clipboard`, flips the clicked button's textContent to "Kopiert!" for 2000 ms.
   - Both factories also registered via `Alpine.data()` in the `alpine:init` event, matching the upload.js convention.

7. **Route registrar extension (`src/routes/archive.ts`)** — two new endpoints added to the existing `registerArchive`:
   - `GET /archive/:id` behind `requireSessionPage(deps)`: ULID regex pre-check → DB lookup → metadata.json read → render. Failures use `renderNotFoundPage` (404) or `renderErrorPage` (500) — never a JSON envelope (plan-checker W3).
   - `POST /api/archive/:id/verify` behind `requireSessionApi(deps)`: ULID + DB checks → `verifyBundleIntegrity` → `c.json(result)`. Failures use `errorResponse` JSON envelope (401 / 404 / 500). Try/catch around the verify call so unhandled errors return INTERNAL_ERROR JSON instead of crashing.

8. **CSS additions (`src/static/style.css`)** — Phase 3 detail-page block appended after the 03-01 list block: `.archive-detail-page`, `.back-link`, `.archive-detail__filename`, `.archive-detail__meta-row`, `.btn--ghost`, `.verify-result`, `.verify-result__ok`, `.verify-result__fail`, `.verify-result__hint`. `.btn--primary` already existed from Phase 2 and was reused unchanged.

9. **UI-SPEC patch (plan-checker W4)** — `.planning/phases/03-archive-browser/03-UI-SPEC.md` §Component Inventory #3 row "TSA-Zeitstempel" changed from `tsa_attested_time` → `tsa_attested_at` to match the Phase 2 DB column.

## Tests

| Layer | File | Tests |
| --- | --- | --- |
| Unit | `tests/unit/formatDetail.test.ts` | 9 (formatBytes + truncateSha matrix) |
| Unit | `tests/unit/verifyIntegrity.test.ts` | 5 (ok / hash_mismatch / file_missing / ext derivation / no-ext) |
| Unit | `tests/unit/archive-detail-view.test.ts` | 18 (structure, copy, escape, fallbacks, W4 guard, NotFound, ErrorPage) |
| E2e | `tests/e2e/archive-detail.test.ts` | 9 (auth gate, ULID validation, content, asset serving, W3 HTML 500, W4 regression) |
| E2e | `tests/e2e/archive-verify.test.ts` | 5 (auth, ULID validation, success, tampered mismatch) |

## Verification

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/formatDetail.test.ts tests/unit/verifyIntegrity.test.ts` | 14/14 passed |
| `npx vitest run tests/unit/archive-detail-view.test.ts` | 18/18 passed |
| `npx vitest run tests/e2e/archive-detail.test.ts tests/e2e/archive-verify.test.ts` | 14/14 passed |
| `npx vitest run` (full suite) | 169/170 passed — 1 pre-existing unrelated `container-smoke.test.ts` timeout (deferred in plan 03-01's deferred-items.md) |
| `npx tsc --noEmit` | exit 0 |
| `grep -c 'tsa_attested_time' src/views/archive-detail.ts` | 0 (W4 source guard) |
| `grep -c 'tsa_attested_time' .planning/phases/03-archive-browser/03-UI-SPEC.md` | 0 (W4 doc guard) |
| `grep -c 'tsa_attested_at' .planning/phases/03-archive-browser/03-UI-SPEC.md` | 2 (W4 doc patched) |
| Per-task RED → GREEN sequence verified in git log | yes (3 RED commits each preceded by a GREEN feat commit) |

## Commits

| Hash | Type | Description |
| --- | --- | --- |
| f6f58bb | test | RED — failing unit tests for formatDetail + verifyIntegrity |
| 9f4fd13 | feat | GREEN — formatBytes, truncateSha, verifyBundleIntegrity |
| 793ddd2 | docs | UI-SPEC patch: tsa_attested_time → tsa_attested_at (W4) |
| a9b2f04 | test | RED — failing unit tests for detail + error views |
| 1e6033c | feat | GREEN — detail view, error-page view, Alpine component, CSS |
| e65a614 | test | RED — failing e2e tests for /archive/:id and verify endpoint |
| 9e55cf7 | feat | GREEN — extend registerArchive with both new endpoints |

## Decisions Made

1. **HTML 500 for page-context failures (W3).** A browser navigating to `/archive/:id` when metadata.json is missing should see a readable German page, not raw JSON. Introduced `renderErrorPage(title, message)` for this purpose. `errorResponse` JSON envelope is now strictly scoped to API endpoints.
2. **Canonical field name `tsa_attested_at` (W4).** Patched UI-SPEC §Component Inventory #3, view code, tests, and Alpine component all to use the DB column name. Added in-file W4 comment in UI-SPEC at the patch point and an explicit regression guard test that asserts the rendered HTML contains no occurrence of the obsolete substring.
3. **`formatBytes` base 1024, not base 1000.** Plan docstring suggested base 1000 but the UI-SPEC fixture values arithmetically only match base 1024 (186777/1024 = 182.40; 5×10⁹/1024³ = 4.66). Implementation uses base 1024 and the file-level comment documents the discrepancy.
4. **Shared `escapeHtml` helper.** Rather than duplicate the attribute-safe escape logic across `archive-list.ts`, `archive-detail.ts`, and `error-page.ts`, the function lives at `src/lib/escapeHtml.ts`. The 03-01 view's existing `escapeAttr` was left in place to minimise churn — both implementations are functionally identical character-for-character.
5. **`timingSafeEqual` on hash comparison.** Both sides of the comparison come from server-trusted sources (computed digest + DB column), so this is defense-in-depth rather than security-critical. Length-difference fallback added because `timingSafeEqual` errors on unequal-length buffers.
6. **Copy button uses `ev.target.dataset.value`.** The button carries the full value in `data-value`, so the Alpine `copyState()` factory has no closure over per-button state — one factory instance per card. This matches the Phase 2 upload.js `copyId` pattern.
7. **Single ULID regex constant per route registrar.** Defined once at module scope (`const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/`); reused in both new endpoints. Matches the pattern in `src/routes/download.ts`.

## Deviations from Plan

None of the auto-fix rules fired. Two micro-adjustments to satisfy the literal acceptance-criteria grep checks:

- A doc comment in `src/views/archive-detail.ts` initially mentioned the obsolete field name in narrative form. Rewrote the comment to avoid the literal substring so the AC `grep -c 'tsa_attested_time'` returns 0 across the source file (regression-guard test was already passing on the rendered output only). Documentation-only change.
- The `app.post(...)` route signature was originally written across four lines (open paren on one line, args on the next three). Reformatted to a single-line `app.post("/api/archive/:id/verify", requireSessionApi(deps), async (c) => {` so the AC `grep -c 'app.post("/api/archive/:id/verify"'` returns 1. No behavioral change.

## Authentication Gates

None. No external auth was required for execution.

## Threat Model Coverage

| Threat ID | Status | Evidence |
| --- | --- | --- |
| T-03-08 (page auth) | Mitigated | `requireSessionPage` on GET /archive/:id; e2e test "redirects to /login?next=%2Farchive%2F<id> when no session cookie" |
| T-03-09 (API auth) | Mitigated | `requireSessionApi` on POST /api/archive/:id/verify; e2e test "returns 401 UNAUTHORIZED envelope without session cookie" |
| T-03-10 (path traversal via :id) | Mitigated | ULID regex `/^[0-9A-HJKMNP-TV-Z]{26}$/` applied before any DB or fs access in both routes; e2e tests with `not-a-ulid-12345` confirm 404 path |
| T-03-11 (path traversal via filename) | Mitigated | `path.extname()` strips everything before the trailing dot; bundle_dir is server-controlled (DB row), not user input |
| T-03-12 (XSS via metadata) | Mitigated | `escapeHtml()` applied to every interpolated value in `renderArchiveDetailPage`; unit test with `<img onerror=...>` payload confirms no live tag emitted |
| T-03-13 (error info leak) | Mitigated | Page endpoint uses `renderErrorPage` (generic German message); API endpoint uses `errorResponse` JSON envelope; full error logged via `console.error` only; e2e test asserts response body contains no `"error":true` substring (W3) |
| T-03-14, T-03-15, T-03-16, T-03-17, T-03-18 | Accepted | Documented as accepted in plan threat register; single-tenant family scale, defense-in-depth measures in place |

## Known Stubs

None. Every UI element is wired to live data: every metadata row sources from the DB row or metadata.json, the verify endpoint actually streams the file from disk, the download CTA points at the existing Phase 2 endpoint.

## TDD Gate Compliance

All three tasks completed the RED → GREEN cycle with separate commits visible in git log:

- Task 1: `test(03-02)` f6f58bb → `feat(03-02)` 9f4fd13
- Task 2: `test(03-02)` a9b2f04 → `feat(03-02)` 1e6033c (with `docs(03-02)` 793ddd2 between for the UI-SPEC patch)
- Task 3: `test(03-02)` e65a614 → `feat(03-02)` 9e55cf7

No REFACTOR commits were needed.

## Self-Check: PASSED

- File `/Users/lennart/Development/auto-archive/src/lib/formatDetail.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/src/lib/verifyIntegrity.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/src/lib/escapeHtml.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/src/views/archive-detail.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/src/views/error-page.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/src/static/archive-detail.js` — FOUND
- File `/Users/lennart/Development/auto-archive/tests/unit/formatDetail.test.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/tests/unit/verifyIntegrity.test.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/tests/unit/archive-detail-view.test.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/tests/e2e/archive-detail.test.ts` — FOUND
- File `/Users/lennart/Development/auto-archive/tests/e2e/archive-verify.test.ts` — FOUND
- Commit f6f58bb — FOUND
- Commit 9f4fd13 — FOUND
- Commit 793ddd2 — FOUND
- Commit a9b2f04 — FOUND
- Commit 1e6033c — FOUND
- Commit e65a614 — FOUND
- Commit 9e55cf7 — FOUND
