---
phase: 02-http-api-web-upload
plan: "04"
subsystem: web-ui
tags: [alpine, html, css, login, session-cookie, static-serving, tdd, hono]

requires:
  - phase: 02-http-api-web-upload
    plan: "01"
    provides: "signSessionCookie, verifySessionCookie, SessionPayload"
  - phase: 02-http-api-web-upload
    plan: "03"
    provides: "AppDeps, createApp(deps), registerUpload"

provides:
  - "renderUploadPage({apiKey}) — full HTML upload form per UI-SPEC"
  - "renderLoginPage({error}) — full HTML login form per UI-SPEC"
  - "registerLogin(app, deps) — GET /login + POST /login + POST /logout"
  - "registerPages(app, deps) — GET / + serveStatic /static/*"
  - "src/static/{alpine.min.js,style.css,upload.js} — vendored/authored static assets"

affects:
  - "02-05 (download route — reuses /login + /static/* surface; no file overlap)"
  - "src/server.ts — registerPages and registerLogin now wired before registerUpload"

tech-stack:
  added:
    - "Alpine.js 3.14.1 (vendored, 46 KB, src/static/alpine.min.js)"
  patterns:
    - "View module pattern: pure function returning <!doctype html> template literal (no engine)"
    - "D-11 API key injection: JSON.stringify(apiKey) into x-data attribute for XHR auth"
    - "serveStatic with rewriteRequestPath: /static/* -> /src/static/* (path rewrite incantation)"
    - "TDD RED/GREEN: failing tests committed first; implementation passes all 15"
    - "isSafeNext() narrow allowlist: must start with '/', no '//', no backslash (T-02-21)"

key-files:
  created:
    - src/views/upload.ts
    - src/views/login.ts
    - src/static/style.css
    - src/static/alpine.min.js
    - src/static/upload.js
    - src/routes/login.ts
    - src/routes/pages.ts
    - tests/e2e/login.test.ts
    - tests/e2e/web-upload.test.ts
  modified:
    - src/server.ts

decisions:
  - "serveStatic rewriteRequestPath incantation used (not root='./src') — rewriteRequestPath strips '/static' prefix so Hono serves from ./src/static/ correctly without breaking other routes"
  - "Alpine.js 3.14.1 vendored from jsdelivr at execution time (46346 bytes, within 30-80KB sanity bound)"
  - "D-11 trade-off honored: GET / is not session-gated in v1; API key injected as JSON literal; documented in src/routes/pages.ts top comment with fallback path"
  - "Login error rendered via 303 redirect to /login?error=1 + server-side HTML (not client-side Alpine) — no JS required for login flow per UI-SPEC D-04"

metrics:
  duration: ~7min
  completed: 2026-05-17
  tasks: 2
  files_created: 9
  files_modified: 1
---

# Phase 2 Plan 04: Web Upload Surface (Views + Routes + Static Assets)

**Browser-facing upload form, login/logout flow, vendored Alpine.js, and hand-authored CSS — all UPLOAD-02 and SEC-02 requirements satisfied with 15 e2e tests passing**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-17T16:12Z
- **Completed:** 2026-05-17T16:19Z
- **Tasks:** 2
- **Files created:** 9
- **Files modified:** 1

## Accomplishments

1. **Task 1 — View modules + static assets**
   - `src/views/upload.ts`: `renderUploadPage({apiKey})` — full UI-SPEC compliant HTML with all German copy strings, drag-drop zone, progress bar, confirmation panel, accessibility attributes
   - `src/views/login.ts`: `renderLoginPage({error})` — login card with error state, no JS required
   - `src/static/style.css`: 230-line hand-authored CSS implementing all 7 spacing tokens (`--space-xs` through `--space-3xl`), full color palette, 44px touch targets, `.progress > .bar`, `.error-banner`, `.confirm`, `.ulid`
   - `src/static/alpine.min.js`: Alpine.js 3.14.1 vendored from CDN at execution time (46346 bytes — no CDN reference in HTML per D-07)
   - `src/static/upload.js`: `uploadForm(apiKey)` Alpine component with XHR + `xhr.upload.onprogress`, all 4 German error copies, `copyId()` with clipboard API

2. **Task 2 (TDD) — Routes + server wiring**
   - `src/routes/login.ts`: `registerLogin()` — GET /login, POST /login (timing-safe compare, HMAC cookie, `isSafeNext()` allowlist), POST /logout (Max-Age=0)
   - `src/routes/pages.ts`: `registerPages()` — GET / with D-11 API key injection, `serveStatic` with `rewriteRequestPath` for src/static/
   - `src/server.ts`: `registerPages` and `registerLogin` wired in correct order (before `registerUpload`)
   - 15/15 e2e tests passing (login flow, cookie attributes, safe-next validation, static asset serving, D-11 round-trip)

## Alpine Version Vendored

**Alpine.js 3.14.1** — downloaded from `https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js` at execution time.
File: `src/static/alpine.min.js`, size: 46346 bytes (within 30–80 KB sanity bound).
No CDN reference appears in any rendered HTML per D-07.

## serveStatic Configuration

The `serveStatic({root: "./src"})` incantation (described in the plan as the primary attempt) does NOT serve correctly because Hono appends the matched path `/static/alpine.min.js` to the root `./src`, producing `./src/static/alpine.min.js` — which works in theory but depends on Hono stripping the prefix before appending. In practice the simpler `rewriteRequestPath` approach is unambiguous:

```typescript
app.use(
  "/static/*",
  serveStatic({
    root: "./",
    rewriteRequestPath: (p) => p.replace(/^\/static/, "/src/static"),
  }),
);
```

This maps `/static/alpine.min.js` → `/src/static/alpine.min.js` relative to `process.cwd()` (the project root). All three static assets return 200 with correct Content-Type headers in e2e tests.

## D-11 Trade-off Documentation

`GET /` is NOT session-gated in v1. The API key is rendered into the upload page HTML at request time via `JSON.stringify(apiKey)` inside the `x-data="uploadForm(...)"` attribute.

**Rationale:** `/` sits behind Cloudflare Tunnel + Caddy on a family-shared deployment. The page itself is the credential carrier. Anyone who can reach `/` can upload — this is acceptable for family-scale use.

**Re-evaluation trigger:** If `/` is ever exposed to non-family parties, or if a multi-user access model is introduced:
1. Add `requireSessionPage(deps)` middleware to GET "/"
2. Remove `apiKey` from `renderUploadPage`
3. Add `GET /api/me/upload-token` (session-gated) returning the key
4. Alpine fetches the token before first upload

This is documented in `src/routes/pages.ts` top comment block.

## E2e Test Coverage

| Test file | Count | Scope |
|-----------|-------|-------|
| `tests/e2e/login.test.ts` | 9 | GET /login, POST /login (success/failure), safe-next, POST /logout |
| `tests/e2e/web-upload.test.ts` | 6 | GET /, API key extraction, /static/* serving, D-11 round-trip |
| **Total** | **15** | **15/15 passing** |

The TDD gate sequence was followed: RED commit (`bf008e3`) before GREEN commit (`b46c9b7`).

## Task Commits

1. **Task 1: View modules + static assets** — `76e514e` (feat)
2. **TDD RED: Failing e2e tests for login/pages** — `bf008e3` (test)
3. **Task 2 GREEN: Routes + server wiring** — `b46c9b7` (feat)

## Files Created/Modified

- `src/views/upload.ts` — `renderUploadPage({apiKey})` with full UI-SPEC inventory
- `src/views/login.ts` — `renderLoginPage({error})` with German error copy
- `src/static/style.css` — hand-authored, all spacing tokens + palette + touch targets
- `src/static/alpine.min.js` — vendored Alpine.js 3.14.1 (46 KB)
- `src/static/upload.js` — `uploadForm(apiKey)` XHR component (D-08)
- `src/routes/login.ts` — timing-safe login, isSafeNext allowlist, Max-Age=0 logout
- `src/routes/pages.ts` — GET /, serveStatic with rewriteRequestPath
- `src/server.ts` — registerPages + registerLogin wired
- `tests/e2e/login.test.ts` — 9 login/logout tests
- `tests/e2e/web-upload.test.ts` — 6 upload page + static tests

## UI-SPEC Deviations

None. All copy strings match the UI-SPEC §"Copywriting Contract" exactly. All component structures match §"Component Inventory". Color tokens are used as specified. Touch target minimum (44px) applied to `.btn` and `.input`.

## Deviations from Plan

None — plan executed exactly as written. The `serveStatic` path rewrite incantation (secondary option listed in plan) was used instead of the primary `root: "./src"` form; this was anticipated and pre-documented in the plan as the fallback. Noted in SUMMARY under "serveStatic Configuration."

## Threat Surface Scan

No new surface beyond what the plan's `<threat_model>` covers:
- `POST /login` — covered by T-02-17 (timingSafeEqual), T-02-19 (HMAC cookie)
- `GET /` — covered by T-02-20 (D-11 accepted trade-off)
- `GET /static/*` — covered by T-02-24 (serveStatic path restriction)
- `POST /logout` — covered by T-02-22 (Max-Age=0)

## Self-Check: PASSED

Files exist on disk:
- src/views/upload.ts: FOUND
- src/views/login.ts: FOUND
- src/static/style.css: FOUND
- src/static/alpine.min.js: FOUND
- src/static/upload.js: FOUND
- src/routes/login.ts: FOUND
- src/routes/pages.ts: FOUND
- tests/e2e/login.test.ts: FOUND
- tests/e2e/web-upload.test.ts: FOUND

Commits in git log:
- 76e514e: feat(02-04) view modules + static assets
- bf008e3: test(02-04) failing e2e tests (RED)
- b46c9b7: feat(02-04) routes + server wiring (GREEN)

---
*Phase: 02-http-api-web-upload*
*Completed: 2026-05-17*
