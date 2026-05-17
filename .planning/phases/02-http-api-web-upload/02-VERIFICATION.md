---
phase: 02-http-api-web-upload
verified: 2026-05-17T18:35:00Z
status: passed
score: 5/5
human_verification_resolved: true
human_verification_resolved_at: 2026-05-17T18:50:00Z
human_verification_resolved_in: .planning/phases/02-http-api-web-upload/02-HUMAN-UAT.md
overrides_applied: 0
human_verification:
  - test: "Browser web upload flow: open / in a real browser, drag a file onto the drag-drop zone, observe progress bar, confirm the confirmation panel shows archive ID and TSA status"
    expected: "File uploads via XHR, progress bar animates, confirmation panel displays ID (copyable), TSA provider, timestamp, and a download link to /api/download/{id}"
    why_human: "Alpine.js interactivity, drag-drop events, clipboard API, and progress bar animation cannot be verified by grep or automated HTTP tests without a real browser runtime"
  - test: "Login page rejects wrong password and grants access with correct password via real browser"
    expected: "Wrong password: page reloads with 'Falsches Passwort.' error message and no session cookie. Correct password: 303 redirect to /, session cookie set with HttpOnly/Secure/SameSite=Lax attributes visible in DevTools"
    why_human: "Cookie attributes (HttpOnly prevents JS access), redirect behavior in browser, and the visual error state rendering require browser-level observation"
---

# Phase 2: HTTP API + Web Upload — Verification Report

**Phase Goal:** Users can submit files from iOS Shortcuts, n8n, curl, or a browser and download a verifiable ZIP bundle — all behind API-key and session authentication.
**Verified:** 2026-05-17T18:35:00Z
**Status:** passed (human items verified via Chrome MCP, see 02-HUMAN-UAT.md)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | curl POST to /api/upload with valid X-API-Key returns 200/201 with archive entry ID; missing/wrong key returns 401 UNAUTHORIZED envelope | VERIFIED | `tests/e2e/auth.test.ts` (11 tests, all pass): missing key → 401 `{error:true,code:"UNAUTHORIZED"}`, wrong key → 401 same envelope, correct key → 201 with `id`. `src/middleware/apiKey.ts` uses `timingSafeEqual` with length pre-check. |
| 2 | A file uploaded via the browser web form is archived and the confirmation page shows the archive ID and TSA status | VERIFIED (partial — server side proven; browser-side Alpine interactivity needs human) | `tests/e2e/web-upload.test.ts` test 6 proves the D-11 round-trip: API key extracted from rendered HTML, multipart POST to /api/upload returns 201. `renderUploadPage` injects `JSON.stringify(apiKey)` into `x-data`. Alpine confirmation panel markup is present in `src/views/upload.ts`. Browser interaction cannot be verified programmatically — see Human Verification. |
| 3 | Downloading a bundle for an archived entry returns a ZIP with original, .sha256, .tsq, .tsr, metadata.json, tsa-cacert.pem, verify.sh, and VERIFY.md with correct § 286 ZPO legal framing | VERIFIED | `tests/e2e/download.test.ts` (3 tests, all pass): ZIP contains exactly 8 entries confirmed via `unzip -l`, VERIFY.md asserted to contain `§ 286 ZPO` and `"Diese Datei beweist"`, sha256 and id values substituted. `src/lib/zipBundle.ts` has 7 `archive.file()` calls + 1 `archive.append()` for VERIFY.md. |
| 4 | Uploading a file larger than 100 MB returns a readable JSON error | VERIFIED | `src/routes/upload.ts` uses `deps.config.maxUploadBytes` (from `loadConfig()` which defaults to 104857600). UploadError with status 413 is caught and returns `errorResponse(c, 413, "FILE_TOO_LARGE", "Datei zu groß. Maximale Größe: 100 MB.")`. E2e auth test confirms error envelope shape. |
| 5 | The archive browser login page rejects wrong passwords and grants access with the correct password | VERIFIED (server side proven; browser-side visual behavior needs human) | `tests/e2e/login.test.ts` (9 tests, all pass): wrong password → 303 to `/login?error=1`, no session cookie. Correct password → 303 to `/`, Set-Cookie with `HttpOnly; Secure; SameSite=Lax; Path=/`. `isSafeNext()` open-redirect guard verified. `timingSafeEqual` used in `src/routes/login.ts`. Browser rendering of "Falsches Passwort." error state requires human confirmation — see Human Verification. |

**Score:** 5/5 truths verified (2 have human verification items for browser-side behavior)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/config.ts` | loadConfig() + AppConfig; fail-fast env validation | VERIFIED | exports `loadConfig`, `AppConfig`; `required()` helper throws on empty; 32-byte SESSION_SECRET check confirmed by `grep`. 7 unit tests pass. |
| `src/middleware/errorEnvelope.ts` | errorResponse + registerErrorEnvelope + ErrorCode | VERIFIED | All three exports confirmed; ErrorCode union has 6 values; errorResponse wired in upload, download, auth middlewares. |
| `src/lib/slug.ts` | slugifyLabel(label) per D-13 | VERIFIED | UMLAUT_MAP, pipeline including 60-char trim and "archive" fallback. 7 unit tests pass. |
| `src/lib/sessionCookie.ts` | signSessionCookie / verifySessionCookie + SessionPayload | VERIFIED | timingSafeEqual present (grep confirmed), expiry check present. 7 unit tests pass. |
| `src/lib/verifyTemplate.ts` | renderVerifyMd(meta) — template substitution | VERIFIED | 5-token substitution confirmed, loaded at module init via readFileSync. 4 unit tests pass. |
| `assets/verify-template.md` | 4 German sections + 5 tokens + § 286 ZPO + legal sentence | VERIFIED | All 4 section headings present, § 286 ZPO present, "beweist nicht die Urheberschaft" present, 9 template token occurrences confirmed. |
| `src/db/schema.ts` | archiveEntries table (13 columns) + 2 indices | VERIFIED | 13 columns from D-19 including all metadata fields, tsa_fallback_chain, bundle_dir. Both indices present. |
| `src/db/client.ts` | openDb(path) with WAL + migration | VERIFIED | PRAGMA journal_mode=WAL confirmed, sqlite.exec() migration approach. |
| `src/db/migrations/0000_init.sql` | CREATE TABLE + 2 indices | VERIFIED | IF NOT EXISTS guards for idempotent startup. |
| `src/db/backfill.ts` | backfillManifest({db, dataDir}) | VERIFIED | onConflictDoNothing, .tmp- filter, console.warn per broken bundle, log line format. 7 unit tests pass. |
| `src/middleware/apiKey.ts` | timing-safe X-API-Key gate | VERIFIED | timingSafeEqual with length pre-check (`expectedBuf.length !== providedBuf.length`). |
| `src/middleware/session.ts` | requireSessionApi + requireSessionPage | VERIFIED | 401 envelope and 303 redirect respectively, encodeURIComponent on next param. |
| `src/middleware/authOrApiKey.ts` | accepts X-API-Key OR session cookie | VERIFIED | OR-composition: API key first, session cookie fallback, 401 only if both fail. |
| `src/routes/upload.ts` | API-key gated, D-23 envelope, D-21 DB insert | VERIFIED | apiKeyMiddleware on route, 5+ errorResponse call sites, DB insert after writeBundle, "bundle stays on disk" log on INSERT failure. |
| `src/routes/download.ts` | registerDownload with authOrApiKey, DB lookup, ZIP stream | VERIFIED | authOrApiKey(deps) on GET /api/download/:id, ULID regex pre-check, Cache-Control: no-store, no Content-Length, Content-Disposition with slug filename. |
| `src/lib/zipBundle.ts` | buildBundleZip — 7 disk files + VERIFY.md | VERIFIED | 7 archive.file() calls + archive.append() for VERIFY.md confirmed by grep and test. |
| `src/views/upload.ts` | renderUploadPage — full UI-SPEC HTML | VERIFIED | All German copy strings present, x-data injection, all 3 static asset references. |
| `src/views/login.ts` | renderLoginPage — login form + error state | VERIFIED | "Anmelden", "Passwort", POST /login action, "Falsches Passwort." error HTML. |
| `src/routes/login.ts` | GET /login + POST /login + POST /logout | VERIFIED | timingSafeEqual, signSessionCookie, isSafeNext, Max-Age=0 logout. |
| `src/routes/pages.ts` | GET / + serveStatic /static/* | VERIFIED | renderUploadPage with apiKey injection, serveStatic with rewriteRequestPath. |
| `src/static/alpine.min.js` | Vendored Alpine.js 3.x (46 KB) | VERIFIED | 46346 bytes (within 30-80 KB bound), no CDN reference in HTML. |
| `src/static/style.css` | UI-SPEC palette + spacing + touch targets | VERIFIED | 22 grep matches for color/spacing tokens (#16a34a, #0f172a, --space-*), min-height: 44px present. |
| `src/static/upload.js` | Alpine uploadForm component with XHR + progress | VERIFIED | XMLHttpRequest, onprogress, X-API-Key, all 4 German error copies, Alpine.data registration confirmed. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/config.ts` | process.env | required() throws on empty | VERIFIED | `grep -n "Missing required env var"` matches in config.ts |
| `src/lib/verifyTemplate.ts` | `assets/verify-template.md` | fileURLToPath + readFileSync | VERIFIED | REPO_ROOT pattern + readFileSync at module init confirmed |
| `src/db/client.ts` | migrations/ | sqlite.exec() reads 0000_init.sql | VERIFIED | Uses raw SQL exec (plan-documented fallback); journal_mode=WAL set |
| `src/db/backfill.ts` | metadata.json on disk | fsp.readdir + onConflictDoNothing | VERIFIED | Both patterns confirmed in source |
| `src/server.ts` | `src/middleware/apiKey.ts` | apiKeyMiddleware(deps.config.apiKey) on POST /api/upload | VERIFIED | `src/routes/upload.ts` line 174: `app.post("/api/upload", apiKeyMiddleware(deps.config.apiKey), ...)` |
| `src/index.ts` | config + db + backfill + createApp | loadConfig → openDb → backfillManifest → createApp → serve | VERIFIED | All 4 steps in order at lines 9, 15, 16, 18 of index.ts |
| `src/routes/upload.ts` | archiveEntries | deps.db.insert(archiveEntries).values(...).run() | VERIFIED | Line 237 confirmed; D-21 orphan log on failure at line 254 |
| `src/routes/download.ts` | `src/middleware/authOrApiKey.ts` | authOrApiKey(deps) wraps route | VERIFIED | `authOrApiKey(deps)` on line 33 of download.ts |
| `src/routes/download.ts` | `src/db/schema.ts` | db.select().from(archiveEntries).where(...).get() | VERIFIED | from(archiveEntries) confirmed at line 44 of download.ts |
| `src/routes/download.ts` | `src/lib/verifyTemplate.ts` | archive.append(renderVerifyMd(meta)) | VERIFIED | `renderVerifyMd` called in zipBundle.ts line 46 |
| `src/routes/login.ts` | `src/lib/sessionCookie.ts` | signSessionCookie on POST /login success | VERIFIED | signSessionCookie imported and called on success path |
| `src/views/upload.ts` | /static/* assets | script/link tags | VERIFIED | /static/style.css, /static/alpine.min.js, /static/upload.js all present in HTML |
| `src/routes/pages.ts` | server.ts | registerPages mounted in createApp | VERIFIED | server.ts line 37: `registerPages(app, deps)` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/routes/upload.ts` | archive entry row | `deps.db.insert(archiveEntries).values({...})` from real writeBundle output | Yes — SHA256, TSA response, ULID all real | FLOWING |
| `src/routes/download.ts` | archive row | `deps.db.select().from(archiveEntries).where(eq(archiveEntries.id, id)).get()` | Yes — real SQLite query from DB populated by upload | FLOWING |
| `src/lib/zipBundle.ts` | ZIP entries | `archive.file()` from real on-disk bundle files | Yes — streams actual files from bundle dir | FLOWING |
| `src/views/upload.ts` | apiKey injection | `deps.config.apiKey` from `loadConfig()` reading `process.env.API_KEY` | Yes — real env var passed through deps | FLOWING |
| `src/routes/login.ts` | session cookie | `signSessionCookie()` with `deps.config.sessionSecret` | Yes — HMAC signed with real secret, verified in e2e login test 9 | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit tests (slug, sessionCookie, config, verifyTemplate) | `vitest run tests/unit/slug.test.ts ...` | 25/25 tests pass | PASS |
| Backfill unit tests | `vitest run tests/unit/backfill.test.ts` | 7/7 tests pass | PASS |
| Auth middleware e2e | `vitest run tests/e2e/auth.test.ts` | 11/11 tests pass | PASS |
| Upload happy-path e2e | `vitest run tests/e2e/upload.happy-path.test.ts` | 2/2 tests pass | PASS |
| Upload fallback (TSA fail) e2e | `vitest run tests/e2e/upload.fallback.test.ts` | 2/2 tests pass | PASS |
| Login/logout e2e | `vitest run tests/e2e/login.test.ts` | 9/9 tests pass | PASS |
| Web upload (GET /, static assets) e2e | `vitest run tests/e2e/web-upload.test.ts` | 6/6 tests pass | PASS |
| Download happy-path + session cookie e2e | `vitest run tests/e2e/download.test.ts` | 3/3 tests pass | PASS |
| Download auth/404 matrix e2e | `vitest run tests/e2e/download.auth.test.ts` | 5/5 tests pass | PASS |
| TypeScript compilation | `npx tsc --noEmit` | 0 errors | PASS |

### Probe Execution

No probes declared in PLAN frontmatter. `scripts/smoke-container.sh` exists but requires Docker and is a container-level test outside scope of automated verification.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UPLOAD-01 | 02-03 | POST /api/upload with X-API-Key returns archive ID; missing/wrong key returns 401 | SATISFIED | auth.test.ts 11 tests; upload.happy-path.test.ts; apiKeyMiddleware in upload.ts |
| UPLOAD-02 | 02-04 | Browser web form upload; externally reachable | SATISFIED | web-upload.test.ts 6 tests including D-11 round-trip; renderUploadPage with Alpine XHR component |
| UPLOAD-03 | 02-05 | Download ZIP bundle with original + SHA-256 + TSR + CA-cert + VERIFY.md | SATISFIED | download.test.ts 3 tests; unzip -l confirms 8 entries including all required files |
| SEC-01 | 02-03 | X-API-Key header auth; invalid keys get 401 | SATISFIED | timingSafeEqual in apiKey.ts; auth.test.ts missing/wrong key → 401 UNAUTHORIZED envelope |
| SEC-02 | 02-04 | Browser login with session auth | SATISFIED | login.test.ts 9 tests; timingSafeEqual password compare; HMAC cookie; isSafeNext open-redirect guard; Max-Age=0 logout |
| LEGAL-01 | 02-01 + 02-05 | VERIFY.md in ZIP with § 286 ZPO framing, RFC 3161, integrity vs authorship | SATISFIED | assets/verify-template.md has all 4 sections, § 286 ZPO, "beweist nicht die Urheberschaft"; download.test.ts VERIFY.md content test confirms § 286 ZPO and "Diese Datei beweist" in actual ZIP |

Note: LEGAL-01 does not appear in the phase-level requirement IDs listed in the prompt but IS assigned to Phase 2 in REQUIREMENTS.md traceability table and in plan 02-05 frontmatter. It is fully satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| No blockers found | — | — | — | — |

Scanned files modified by this phase: all files in src/lib/, src/middleware/, src/routes/, src/views/, src/static/, src/db/, assets/verify-template.md. No TBD, FIXME, or XXX markers found. No stub implementations (empty returns, placeholder values) detected. All D-11 trade-off decisions are explicitly documented in source comments with re-evaluation triggers.

### Human Verification Required

#### 1. Browser drag-drop upload with progress bar

**Test:** Open the app in a browser at `/`. Drag a file (e.g., a PDF) onto the drag-drop zone. Observe the upload flow.
**Expected:** Progress bar animates as upload progresses. On completion, the confirmation panel appears with: archive ID in `<code>` with a copy button, TSA provider name, timestamp, and "Archiv-Bundle herunterladen" download link to `/api/download/{id}`. Clicking the copy button copies the ID to clipboard.
**Why human:** Alpine.js XHR events (`xhr.upload.onprogress`), state transitions (`idle → uploading → success`), clipboard API (`navigator.clipboard.writeText`), and drag-drop event handling cannot be verified without a real browser runtime.

#### 2. Login page error state and session cookie attributes

**Test:** Navigate to `/login`. Submit the form with a wrong password. Then submit with the correct password.
**Expected:** Wrong password: page reloads with the red error message "Falsches Passwort." visible, no session cookie in DevTools Application tab. Correct password: redirect to `/`, session cookie visible in DevTools with HttpOnly, Secure, SameSite=Lax, Path=/ attributes.
**Why human:** Cookie `HttpOnly` attribute prevents JavaScript from reading the cookie (so automated tests can only check the Set-Cookie header value, which login.test.ts already does). Visual rendering of the error state and the session state in DevTools require browser observation.

### Gaps Summary

No blocking gaps. All 5 success criteria are met with automated test evidence. The 2 human verification items cover browser-side UI interactivity and cookie attribute visibility in DevTools — these are expected for any web frontend phase and do not indicate incomplete implementation.

The phase goal is achieved: users can submit files via iOS Shortcuts/n8n/curl (X-API-Key) and via browser web form (Alpine XHR), receive a verifiable ZIP bundle with RFC 3161 timestamps and § 286 ZPO legal framing, all behind API-key and session authentication.

---

_Verified: 2026-05-17T18:35:00Z_
_Verifier: Claude (gsd-verifier)_
