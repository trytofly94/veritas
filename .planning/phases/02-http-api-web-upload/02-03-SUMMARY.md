---
phase: 02-http-api-web-upload
plan: "03"
subsystem: auth
tags: [hono, middleware, timing-safe, hmac, sqlite, drizzle, api-key, session-cookie]

requires:
  - phase: 02-http-api-web-upload
    plan: "01"
    provides: "loadConfig, AppConfig, errorResponse/errorEnvelope, signSessionCookie/verifySessionCookie"
  - phase: 02-http-api-web-upload
    plan: "02"
    provides: "openDb, Db type, archiveEntries schema, backfillManifest"

provides:
  - "apiKeyMiddleware(expected) — timing-safe X-API-Key gate (D-01)"
  - "requireSessionApi(deps) — 401 envelope on missing/invalid session cookie"
  - "requireSessionPage(deps) — 303 redirect on missing/invalid session cookie"
  - "authOrApiKey(deps) — accepts X-API-Key OR session cookie (D-12)"
  - "AppDeps interface { db: Db; config: AppConfig } exported from server.ts"
  - "createApp(deps: AppDeps) — Hono factory with error envelope + upload route"
  - "index.ts — full bootstrap: loadConfig -> openDb -> backfillManifest -> createApp(deps) -> serve"
  - "POST /api/upload — API-key gated, D-23 error envelope, D-21 DB insert on success"

affects:
  - "02-04 (pages/login/static — all registrars use AppDeps injection pattern)"
  - "02-05 (download route — uses authOrApiKey + archiveEntries DB lookup)"

tech-stack:
  added: []
  patterns:
    - "Middleware factory pattern: export function middleware(deps: AppDeps): MiddlewareHandler"
    - "Timing-safe auth: pre-encode expectedBuf outside closure; length check before timingSafeEqual"
    - "AppDeps injection bag: db + config injected at startup; routes never read process.env directly"
    - "D-23 error envelope: all /api/* non-2xx go through errorResponse(c, status, code, message)"
    - "D-21 order: writeBundle -> INSERT archiveEntries -> respond; on INSERT fail log + 500 + bundle stays for backfill"

key-files:
  created:
    - src/middleware/apiKey.ts
    - src/middleware/session.ts
    - src/middleware/authOrApiKey.ts
    - tests/e2e/auth.test.ts
  modified:
    - src/server.ts
    - src/index.ts
    - src/routes/upload.ts
    - tests/e2e/upload.happy-path.test.ts
    - tests/e2e/upload.fallback.test.ts
    - tests/e2e/upload.digicert-success.test.ts
    - tests/e2e/verify-script.test.ts
    - docker-compose.yml
    - scripts/smoke-container.sh

key-decisions:
  - "AppDeps defined in server.ts (not a shared types file) — single source of truth for the factory signature, imported by middlewares via server.js"
  - "Tasks 1+2 committed together (489b145) — server.ts/index.ts rewrite was required to make auth.test.ts pass (createApp signature changed); logical boundary kept in commit message"
  - "D-21 zero-footprint assertion in fallback test updated to filter manifest.sqlite WAL files — DB now lives in dataDir, which is expected (manifest is a valid artifact)"
  - "docker-compose.yml uses shell variable substitution with defaults (${API_KEY:-smoke-test-...}) so container smoke test works without .env file"

patterns-established:
  - "Middleware factory: function returning MiddlewareHandler, injected with deps at registration time"
  - "E2e harness Phase 2 pattern: set API_KEY/SESSION_SECRET/ADMIN_PASSWORD/MANIFEST_DB_PATH before calling loadConfig(); build deps inline; pass to createApp(deps)"
  - "Upload route: uses apiKeyMiddleware inline on app.post('/api/upload', middleware, handler)"

requirements-completed: [UPLOAD-01, SEC-01]

duration: ~45min
completed: 2026-05-17
---

# Phase 2 Plan 03: Auth Middleware + Bootstrap Rewire Summary

**X-API-Key gate (timing-safe), HMAC session middlewares, AppDeps injection, and D-23 error envelope wired across the full upload route with D-21 DB insert**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-17T17:58Z
- **Completed:** 2026-05-17T18:10Z
- **Tasks:** 3 (+ 1 Rule 3 fix commit)
- **Files modified:** 12

## Accomplishments
- Three auth middlewares: `apiKeyMiddleware` (timing-safe), `requireSessionApi` (401 envelope), `requireSessionPage` (303 redirect), `authOrApiKey` (either X-API-Key OR session cookie)
- Full bootstrap rewire: `loadConfig → openDb → backfillManifest → createApp(deps) → serve` — process hard-fails with named env var in error before port bind
- Upload route now API-key-gated, D-23 compliant on all error paths, inserts into `archive_entries` after `writeBundle` (D-21), logs chain on TSA failure without exposing it in response body
- Phase 1 e2e suite fully migrated: all 3 test files updated with auth headers + deps; Phase 1 warning removed

## Middleware Signatures Shipped

| Export | File | Guards |
|--------|------|--------|
| `apiKeyMiddleware(expected: string)` | `src/middleware/apiKey.ts` | pre-encoded `expectedBuf`; length check; `timingSafeEqual` |
| `requireSessionApi(deps: AppDeps)` | `src/middleware/session.ts` | `verifySessionCookie` HMAC check; 401 envelope on fail |
| `requireSessionPage(deps: AppDeps)` | `src/middleware/session.ts` | same check; 303 redirect to `/login?next=...` on fail |
| `authOrApiKey(deps: AppDeps)` | `src/middleware/authOrApiKey.ts` | X-API-Key first; cookie fallback; 401 only if both fail |

## AppDeps Shape (server.ts)

```typescript
export interface AppDeps {
  db: Db;          // BetterSQLite3Database from drizzle-orm/better-sqlite3
  config: AppConfig; // from src/lib/config.ts
}
export function createApp(deps: AppDeps): Hono;
```

`AppDeps` lives in `src/server.ts` (not a shared types file). Middlewares import it via `"../server.js"`.

## Error Code → Status Mapping (upload.ts)

| Situation | Status | Code | Message |
|-----------|--------|------|---------|
| Missing/wrong X-API-Key | 401 | UNAUTHORIZED | "Nicht authentifiziert." |
| Missing file part | 400 | INVALID_REQUEST | "Ungültige Anfrage." |
| Label validation failed | 400 | INVALID_REQUEST | "Ungültige Anfrage." |
| File > maxUploadBytes | 413 | FILE_TOO_LARGE | "Datei zu groß. Maximale Größe: 100 MB." |
| All TSAs failed | 502 | TSA_UNAVAILABLE | "Zeitstempel-Dienst nicht erreichbar..." |
| DB insert failed after bundle | 500 | INTERNAL_ERROR | "Unbekannter Fehler." |
| Server misconfigured | 500 | INTERNAL_ERROR | "Unbekannter Fehler." |

## E2e Harness Change Pattern

Every Phase 1 e2e test now follows this `beforeAll` pattern:

```typescript
// 1. Set all Phase 2 required env vars BEFORE calling loadConfig
process.env.DATA_DIR = dataDir;
process.env.API_KEY = TEST_API_KEY;
process.env.SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";
process.env.ADMIN_PASSWORD = "test-pass";
process.env.MANIFEST_DB_PATH = path.join(dataDir, "manifest.sqlite");

// 2. Build deps inline
const config = loadConfig();
const db = openDb(config.manifestDbPath);

// 3. Pass deps to createApp
const app = createApp({ db, config });

// 4. Every fetch to /api/upload includes X-API-Key header
headers: { "X-API-Key": TEST_API_KEY }
```

## Phase 1 E2e Suite Status

All Phase 1 suites pass after migration:
- `upload.happy-path.test.ts` ✓ (+ new D-21 DB row assertion)
- `upload.fallback.test.ts` ✓ (502 assertion updated to D-23 TSA_UNAVAILABLE envelope)
- `upload.digicert-success.test.ts` ✓ (X-API-Key header added)
- `verify-script.test.ts` ✓ (auth env vars + deps added; X-API-Key in uploadFixture)
- `auth.test.ts` ✓ (new — 11 tests covering all middleware behaviors)

## Task Commits

1. **Tasks 1+2: Three auth middlewares + wire createApp(deps)** - `489b145` (feat)
2. **Task 3: Upload route rewire + e2e harness migration** - `bcf0073` (feat)
3. **Rule 3 fixes: verify-script + container config** - `416cea4` (fix)

## Files Created/Modified

- `src/middleware/apiKey.ts` — timing-safe X-API-Key middleware factory
- `src/middleware/session.ts` — requireSessionApi + requireSessionPage factories
- `src/middleware/authOrApiKey.ts` — OR-composed auth middleware for download endpoint
- `src/server.ts` — export AppDeps; createApp(deps: AppDeps); Phase 1 warning removed; error envelope registered first
- `src/index.ts` — full Phase 2 bootstrap with loadConfig/openDb/backfillManifest/createApp
- `src/routes/upload.ts` — full rewrite: apiKeyMiddleware gate, errorResponse everywhere, D-21 DB insert, maxUploadBytes from config
- `tests/e2e/auth.test.ts` — new: 401 envelope for missing/wrong key; session probe; authOrApiKey probe (11 tests)
- `tests/e2e/upload.happy-path.test.ts` — auth env vars + deps + X-API-Key + D-21 DB row assertion
- `tests/e2e/upload.fallback.test.ts` — auth env vars + deps + X-API-Key + TSA_UNAVAILABLE envelope assertion
- `tests/e2e/upload.digicert-success.test.ts` — auth env vars + deps + X-API-Key header
- `tests/e2e/verify-script.test.ts` — auth env vars + deps + X-API-Key in uploadFixture
- `docker-compose.yml` — Phase 2 env vars with shell-variable defaults for smoke test
- `scripts/smoke-container.sh` — X-API-Key header in curl POST

## Decisions Made

- `AppDeps` defined in `server.ts` (not a shared `types.ts`) — avoids circular imports since middlewares import from server to get the type, and server imports from middlewares to use them
- Tasks 1 and 2 were committed together because `server.ts` rewrite was needed to make `auth.test.ts` compile and pass
- `docker-compose.yml` uses `${API_KEY:-smoke-test-api-key-change-in-production}` defaults so the existing container smoke test works without a `.env` file

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] verify-script.test.ts called createApp() with no args**
- **Found during:** Task 3 full test suite run
- **Issue:** `verify-script.test.ts` called `createApp()` with zero arguments — TypeScript error and runtime crash after server.ts signature change
- **Fix:** Added auth env vars to beforeAll, built deps inline, passed to createApp; added X-API-Key to uploadFixture()
- **Files modified:** tests/e2e/verify-script.test.ts
- **Verification:** All 6 verify-script tests pass
- **Committed in:** 416cea4

**2. [Rule 3 - Blocking] docker-compose.yml missing Phase 2 required env vars**
- **Found during:** Task 3 full test suite run (container-smoke test)
- **Issue:** Container failed to start — loadConfig() throws on missing API_KEY/SESSION_SECRET/ADMIN_PASSWORD before port bind
- **Fix:** Added all Phase 2 env vars to docker-compose.yml with shell-variable defaults; smoke script sends X-API-Key header
- **Files modified:** docker-compose.yml, scripts/smoke-container.sh
- **Verification:** docker-compose.yml has all required vars; TypeScript clean
- **Committed in:** 416cea4

**3. [Rule 1 - Bug] Fallback test zero-footprint assertion included manifest DB files**
- **Found during:** Task 3 e2e run
- **Issue:** The "zero disk footprint" assertion `expect(after).toEqual([])` failed because manifest.sqlite WAL files are now in downDir (Phase 2 DB lives there)
- **Fix:** Filter out `manifest.sqlite*` files from the assertion — only bundle directories matter for the D-05 invariant
- **Files modified:** tests/e2e/upload.fallback.test.ts
- **Verification:** All fallback tests pass
- **Committed in:** bcf0073

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All fixes necessary for correctness after Phase 2 signature changes propagated. No scope creep.

## Issues Encountered

- `tsa.fallback.test.ts` has a flaky test ("verify failure rejects provider") that occasionally fails when run concurrently with other e2e tests using real TSA endpoints — pre-existing issue, not caused by this plan. It passes consistently when run in isolation.

## Next Phase Readiness

- `AppDeps` interface and injection pattern ready for Plans 04 (pages/login/static) and 05 (download route)
- `authOrApiKey` middleware ready to be applied to `GET /api/download/:id` in Plan 05
- `requireSessionPage` middleware ready for Plan 04's page route guards
- All SEC-01 and UPLOAD-01 requirements satisfied

---
*Phase: 02-http-api-web-upload*
*Completed: 2026-05-17*
