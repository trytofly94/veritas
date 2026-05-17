---
phase: 03-archive-browser
plan: "01"
subsystem: archive-browser
tags: [archive-browser, list, mvp-slice, hono, session-auth, drizzle, table, ui-spec, browse-01]
requires:
  - phase-02/session-cookie-middleware (requireSessionPage)
  - phase-02/archive_entries-schema (Drizzle table)
  - phase-02/style.css-tokens (--space-*, --c-* variables)
provides:
  - GET /archive (auth-gated archive list page)
  - renderArchiveListPage view
  - formatRowDate / mimeToType / tsaBadgeProps formatters
  - .archive-table / .tsa-badge--ok|local|failed / .empty-state CSS classes
affects:
  - src/server.ts (new registrar slot between login and download)
tech-stack:
  added: []
  patterns:
    - "Per-cell semantic <a> for row navigation (no row-level JS handlers; CSS-only hover affordance)"
    - "Attribute-safe HTML escape covering text + title attribute contexts (single escape, dual reuse)"
    - "Status normalization: tsaBadgeProps treats both 'ok' and 'verified' as success (Phase 2 manifest uses 'verified')"
key-files:
  created:
    - src/lib/formatList.ts
    - src/views/archive-list.ts
    - src/routes/archive.ts
    - tests/unit/formatList.test.ts
    - tests/e2e/archive-list.test.ts
    - .planning/phases/03-archive-browser/deferred-items.md
  modified:
    - src/server.ts
    - src/static/style.css
decisions:
  - "Row navigation = per-cell <a> only. No onclick / onkeydown / tabindex / role on <tr>. CSS hover-only affordance. (plan-checker W1)"
  - "Filename cell <a> carries title=\"{escapedFilename}\" so truncated names remain recoverable on hover. (plan-checker W2)"
  - "CSS source order: generic '.archive-table tbody td' precedes '.archive-table tbody td:first-child' so source-order specificity wins. (plan-checker I1)"
  - "tsaBadgeProps accepts both 'ok' and 'verified' status strings — Phase 2 stores 'verified' on success; the formatter is forward-compatible with either."
  - "Empty state and populated state share the same page chrome (header, archive-page container) — only the body switches between <table> and <div class=empty-state>."
metrics:
  duration_min: 5
  completed: 2026-05-17
  tasks: 2
  files_changed: 8
  unit_tests_added: 26
  e2e_tests_added: 11
---

# Phase 03 Plan 01: Authenticated archive list at `GET /archive` Summary

Server-rendered HTML archive list page behind a session cookie gate. Closes BROWSE-01 — Lennart can now open `/archive` after logging in and see every archived file with filename, date, type, and TSA status badge, sorted newest-first.

## What was built

1. **Pure formatters (`src/lib/formatList.ts`)** — three pure functions:
   - `formatRowDate(iso)` slices a canonical ISO string to `YYYY-MM-DD HH:mm` UTC, returning `"—"` for invalid input.
   - `mimeToType(mime)` returns the uppercase MIME subtype (special case: `text/plain` → `"TXT"`).
   - `tsaBadgeProps(provider, status)` returns `{ className, label }` per UI-SPEC §TSA Status Badge Color Mapping. Treats `"ok"` and `"verified"` as success.
2. **View module (`src/views/archive-list.ts`)** — `renderArchiveListPage({ entries })` returns the full HTML document. Semantic `<table>` with per-cell `<a>` (no row-level JS). Empty state copy is the UI-SPEC verbatim German text. Attribute-safe escape (`&`, `<`, `>`, `"`, `'`) used for both anchor body and `title` attribute.
3. **Route registrar (`src/routes/archive.ts`)** — `registerArchive(app, deps)` mounts `GET /archive` behind `requireSessionPage(deps)`. Drizzle query: `db.select().from(archiveEntries).orderBy(desc(archiveEntries.created_at)).all()`. Rows mapped to `ArchiveListEntry` and rendered. Try/catch around the query returns a generic German error envelope (`Fehler beim Laden des Archivs. Bitte Seite neu laden.`) on internal failure.
4. **Server wiring (`src/server.ts`)** — `registerArchive` inserted between `registerLogin` and `registerDownload` so all session-gated page routes are grouped, with comment `// 5b. Archive browser routes: GET /archive (+ /archive/:id added by 03-02)`.
5. **CSS additions (`src/static/style.css`)** — appended Phase 3 block: `.archive-page`, `.archive-page__header`, `.archive-table` (with header, row, generic-td, first-child-override, and inner-anchor rules in the prescribed source order), `.tsa-badge` + three modifier classes, `.empty-state`.

## Tests

- **Unit (`tests/unit/formatList.test.ts`, 26 tests):** Every behavior in the plan's `<behavior>` block plus three extra assertions (XSS escape, title attribute presence, no `onclick`/`onkeydown` substring).
- **E2e (`tests/e2e/archive-list.test.ts`, 11 tests):** Unauth → 303 `/login?next=%2Farchive`; tampered cookie → same redirect; empty state HTML; 3 rows in descending order; three TSA badge variants; `application/pdf` → `PDF`; per-cell anchor with `title` attribute; no `onclick`/`onkeydown` in rendered output; header link to `/`.

## Verification

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/formatList.test.ts` | 26/26 passed |
| `npx vitest run tests/e2e/archive-list.test.ts` | 11/11 passed |
| `npx vitest run` (full suite) | 123/124 passed — 1 unrelated pre-existing failure (`container-smoke.test.ts` timeout, logged in `deferred-items.md`, confirmed pre-existing via stash-check) |
| `npx tsc --noEmit` | exit 0 |
| Per-task git log | `test(03-01)` → `feat(03-01)` → `test(03-01)` → `feat(03-01)` (4 commits, RED-then-GREEN per task) |

## Commits

| Hash | Type | Description |
| --- | --- | --- |
| 598bc25 | test | RED — failing unit tests for formatList + view |
| 68eb6b3 | feat | GREEN — formatters, view module, Phase 3 CSS |
| 85624d4 | test | RED — failing e2e tests for GET /archive |
| c6e037a | feat | GREEN — route registrar with auth gate + server wiring |

## Decisions Made

1. **Row navigation via per-cell anchor only (no row-level JS).** Plan-checker W1. The `<tr>` carries no `onclick`/`onkeydown`/`tabindex`/`role`. Hover affordance is delivered via CSS (`cursor: pointer` on `<tr>`, `:hover` background change). Keyboard and screen reader navigation work natively through the cell `<a>` — no shim required.
2. **`title=` attribute on the filename anchor.** Plan-checker W2. CSS truncates the first column to `max-width: 200px` with ellipsis. The `title` attribute holds the full (escaped) filename so the browser's native tooltip recovers it on hover.
3. **CSS source order matters.** Plan-checker I1. The generic `.archive-table tbody td { color: #64748b; }` (muted) rule must sit before the `.archive-table tbody td:first-child { color: #0f172a; }` (primary) override — they share specificity so source order wins.
4. **`tsaBadgeProps` accepts both `"ok"` and `"verified"`.** Phase 2's `metadata.json` and SQLite manifest use `"verified"` as the success status. The plan's `<behavior>` block uses `"ok"`. Rather than force callers to normalize, the formatter accepts either spelling.
5. **Attribute-safe single escape function.** A single `escapeAttr()` helper encodes `&`, `<`, `>`, `"`, `'`. The same escaped string is reused for both the anchor body text and the `title` attribute value (attribute-safe escaping is a superset of text-context escaping). This avoids two parallel escape functions diverging.
6. **Try/catch returns error envelope JSON on DB failure.** The UI-SPEC error copy is German (`Fehler beim Laden des Archivs…`). The page itself can't render if the query throws, so the v1 fallback returns the existing `errorResponse` envelope — acceptable per the plan's note in Task 2 `<action>`.

## Deviations from Plan

None of the auto-fix rules fired. The plan executed exactly as written with two minor proactive edits:

- The view module's source-code comments originally contained the literal strings `"onclick"` and `"onkeydown"` while describing the intentional absence of those handlers. The acceptance criteria use a literal `grep -c` on the source file for those substrings and expect `0`. Comments were reworded to "JS click/key handlers" so the grep matches the intent. This is a documentation-only adjustment, not a behavioral change.
- A `.planning/phases/03-archive-browser/deferred-items.md` file was created to record the pre-existing `container-smoke.test.ts` failure that surfaced during full-suite verification. Confirmed pre-existing on `master` before this plan started via `git stash` + isolated rerun.

## Authentication Gates

None. No external auth was required for execution.

## Threat Model Coverage

| Threat ID | Status | Evidence |
| --- | --- | --- |
| T-03-01 (auth gate) | Mitigated | `requireSessionPage(deps)` applied to `GET /archive`; e2e test "redirects to /login?next=%2Farchive when no session cookie is present" |
| T-03-02 (cookie tamper) | Mitigated | Inherited `verifySessionCookie` + `timingSafeEqual`; e2e test "redirects to /login?next=%2Farchive when session cookie HMAC is invalid" |
| T-03-04 (open redirect) | Mitigated | `requireSessionPage` only uses `c.req.path` (server-controlled) when building `?next=`; not user input. No new attack surface in this plan. |
| T-03-05 (XSS via filename) | Mitigated | `escapeAttr()` handles both text and attribute contexts; unit tests `<script>` escape + double-quote-in-title escape both pass |
| T-03-07 (error info leak) | Mitigated | try/catch returns `Fehler beim Laden des Archivs…` envelope; internal error logged via `console.error` only |
| T-03-03 (IDOR), T-03-06 (DoS) | Accepted | Single-tenant family scale; documented in plan threat register |

## Known Stubs

None. Every documented behavior is wired end-to-end and exercised by tests.

## TDD Gate Compliance

Both tasks completed the RED → GREEN cycle with separate commits:

- Task 1: `test(03-01)` → `feat(03-01)` (commits `598bc25` → `68eb6b3`)
- Task 2: `test(03-01)` → `feat(03-01)` (commits `85624d4` → `c6e037a`)

No REFACTOR commits were needed — the implementations passed cleanly on first GREEN attempt.

## Self-Check: PASSED

- File `src/lib/formatList.ts` — FOUND
- File `src/views/archive-list.ts` — FOUND
- File `src/routes/archive.ts` — FOUND
- File `tests/unit/formatList.test.ts` — FOUND
- File `tests/e2e/archive-list.test.ts` — FOUND
- Commit `598bc25` — FOUND
- Commit `68eb6b3` — FOUND
- Commit `85624d4` — FOUND
- Commit `c6e037a` — FOUND
