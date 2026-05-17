# Phase 2: HTTP API + Web Upload - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 layers four capabilities on top of the Phase 1 archive engine:

1. **Authentication** — `X-API-Key` middleware on `POST /api/upload` (SEC-01), and a password-protected session for the browser surface (SEC-02). The login page lives in this phase; the browser list view it gates lives in Phase 3.
2. **Web upload form** — A static single-page HTML form (Alpine.js) served at `/`, performing multipart upload via XHR with a progress bar and confirmation panel (UPLOAD-02).
3. **Download bundle** — A ZIP endpoint returning the full Phase 1 bundle plus a German `VERIFY.md` with § 286 ZPO legal framing (UPLOAD-03, LEGAL-01).
4. **SQLite manifest** — Drizzle + better-sqlite3 table mirroring `metadata.json`, populated by a startup backfill that scans the bundle directory. Needed by the download endpoint (ID → bundle dir lookup) and by Phase 3's browser.

The 100 MB upload cap is enforced inside this phase (busboy stream-abort) so iOS Shortcut / n8n / curl callers get a readable JSON error before Cloudflare terminates the connection.

Out of scope: the archive browser list/detail UI (Phase 3), OpenTimestamps anchoring (v2), retry queue for failed timestamps (v2), per-user accounts.

</domain>

<decisions>
## Implementation Decisions

### Authentication
- **D-01:** Single `API_KEY` env var. Middleware on `POST /api/upload` compares `X-API-Key` using `crypto.timingSafeEqual`. Missing or wrong key → `401` with JSON error envelope. **Rationale:** family-scale, one Unraid instance, no rotation infra needed in v1. Per-source labels and key revocation deferred.
- **D-02:** Browser session = HMAC-signed cookie. Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/`. Signed with `SESSION_SECRET` env var (HMAC-SHA256). No server-side session table — the cookie *is* the session (payload: `{user: "admin", iat, exp}`).
- **D-03:** Single shared `ADMIN_PASSWORD` env var for the browser login. Compared with `crypto.timingSafeEqual` against the form input. No per-user accounts.
- **D-04:** Login route: `POST /login` (form-encoded `password`). Success sets the session cookie and redirects to `/` (or original `?next=` param if safe-listed). Logout: `POST /logout` clears the cookie.
- **D-05:** CSRF: rely on `SameSite=Lax` for the form POSTs in v1 (no cross-origin session-authenticated POSTs exist — n8n/iOS use the API-key path, not the browser session). Revisit if a third-party origin ever needs session auth.
- **D-06:** Two startup-fail invariants: if `API_KEY`, `SESSION_SECRET`, or `ADMIN_PASSWORD` env vars are missing/empty, the process exits with a clear error before binding the port. No insecure defaults.

### Web upload UX (UPLOAD-02)
- **D-07:** Single static HTML page at `GET /`, served by Hono. Uses Alpine.js (loaded from a vendored static asset, not CDN, so the container is self-contained on Unraid). One page, no router.
- **D-08:** Form elements: drag-drop zone OR file picker (both feed the same `File` reference), optional `label` text input, submit button. On submit, XHR POST to `/api/upload` (multipart) with `XMLHttpRequest.upload.onprogress` driving a progress bar.
- **D-09:** Confirmation panel (replaces the form after success): archive ID (ULID, copyable), TSA provider (`dfn` | `freetsa` | `digicert`), TSA-attested timestamp, link to download the ZIP (`/api/download/:id`), and a one-line hint pointing at `verify.sh` for offline verification.
- **D-10:** UI language: **German only**. Matches REQUIREMENTS.md voice. No i18n infrastructure in v1.
- **D-11:** The web form sends the SAME `X-API-Key` header as API consumers — the static HTML is rendered by Hono with the key value injected from env (so the form works without a separate login). The browser session/login covers the *browser surface* (Phase 3 list view + future settings), not the upload form itself. Alternative considered: gate the form behind the session. Rejected because it would require either duplicating auth paths or shipping the API key to the browser anyway. Documented trade-off: anyone who can reach `/` can upload; this is acceptable because `/` is behind Cloudflare Tunnel + Caddy and only family-shared.

> **Note for planner:** D-11 makes the page itself the credential. If this feels wrong on a second look, the fallback is to render the upload page only after a session login (SEC-02 path) and have it pull the API key via an authenticated `GET /api/me/upload-token`. Call this out in PLAN.md if you take that route.

### Download bundle (UPLOAD-03, LEGAL-01)
- **D-12:** Endpoint: `GET /api/download/:id` — requires the same `X-API-Key` (or session cookie — middleware accepts either).
- **D-13:** ZIP filename: `{label-slug}-{ULID}.zip`, where `label-slug` is `label` lowercased, non-alphanumerics replaced with `-`, trimmed to 60 chars, falls back to `archive` if empty after slugging.
- **D-14:** ZIP contents (exact set, no more, no less): `original.<ext>`, `original.sha256`, `original.tsq`, `original.tsr`, `tsa-cacert.pem`, `metadata.json`, `verify.sh`, `VERIFY.md`.
- **D-15:** Streamed via `archiver` (no temp file). Response headers: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="..."`, `Cache-Control: no-store`. No `Content-Length` (streaming).
- **D-16:** `VERIFY.md` is **German**, generated per-bundle (substitutes ID, filename, sha256, tsa_provider, tsa_attested_at). Sections:
  - **Was ist das?** — short explanation of the bundle and what each file proves.
  - **Wie prüfen** — two paths: (a) `bash verify.sh` (one-command), (b) manual `openssl ts -verify -in original.tsr -data original.<ext> -CAfile tsa-cacert.pem` + sha256 recomputation.
  - **Rechtlicher Rahmen** — § 286 ZPO (freie Beweiswürdigung), RFC 3161 mechanics, eIDAS-Anlehnung note (the timestamp is technically a "Zeitstempel" in the eIDAS sense; whether it qualifies as "qualifiziert" depends on the TSA — DFN-PKI is on the trust list, FreeTSA is not). Stress that this is an **integrity + time-of-existence proof**, not authorship proof.
  - **TSA-Vertrauensquelle** — which TSA signed THIS bundle (from `metadata.json.tsa_provider`), and a note on the fallback chain used.
- **D-17:** A static `VERIFY.template.md` lives in the repo (`assets/verify-template.md` or similar — planner picks). Per-bundle substitutions use simple `{{var}}` tokens, no template engine.

### SQLite manifest
- **D-18:** Drizzle ORM + `better-sqlite3`. DB file at a bind-mounted path (sibling to bundles dir, e.g. `/data/manifest.sqlite`). Drizzle Kit migration on startup (idempotent `CREATE TABLE IF NOT EXISTS` via generated migration).
- **D-19:** Schema — table `archive_entries` mirrors `metadata.json` fields 1:1 plus `bundle_dir`:
  ```
  id TEXT PRIMARY KEY,                  -- ULID
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,             -- ISO 8601 UTC
  label TEXT NOT NULL,
  source_ip TEXT NOT NULL,
  tsa_provider TEXT NOT NULL,           -- 'dfn' | 'freetsa' | 'digicert'
  tsa_status TEXT NOT NULL,             -- 'verified' (only value in v1)
  tsa_attested_at TEXT NOT NULL,
  tsa_fallback_chain TEXT NOT NULL,     -- JSON array as TEXT
  bundle_dir TEXT NOT NULL              -- absolute path on the host volume
  ```
  Indices: `created_at DESC` (browser list), `sha256` (dedup lookup, future).
- **D-20:** **Startup backfill** — on app boot (after migration), scan the bundles root, parse each `metadata.json`, `INSERT OR IGNORE` into `archive_entries`. Broken bundles (missing or unparseable `metadata.json`) are logged with their dir path and **skipped** — the app boots normally. Backfill runs synchronously before the server listens (acceptable for family-scale; a few thousand bundles parse in <1s).
- **D-21:** Each successful upload writes to BOTH disk (the bundle) AND the DB row in the same request, inside a try/finally that deletes the row if the bundle write fails after the DB insert (avoid orphans). Order: write bundle → INSERT row → respond. If INSERT fails after the bundle exists, log the orphan and respond 500 (backfill will pick it up on next boot).

### Size limit + error envelope
- **D-22:** 100 MB enforced in busboy via `limits: { fileSize: 100 * 1024 * 1024 }`. On the file stream's `limit` event, abort the request and respond 413 with the error envelope. Caddy/Cloudflare-side enforcement is deferred — the app must self-protect.
- **D-23:** Error envelope (JSON, served on all 4xx/5xx from `/api/*`):
  ```json
  {
    "error": true,
    "code": "FILE_TOO_LARGE",
    "message": "Datei zu groß (max 100 MB)"
  }
  ```
  Codes (initial set): `UNAUTHORIZED`, `FILE_TOO_LARGE`, `INVALID_REQUEST`, `TSA_UNAVAILABLE`, `NOT_FOUND`, `INTERNAL_ERROR`. Messages are German strings.
- **D-24:** Status codes: `401` for missing or wrong API key / wrong password. `403` is **reserved** for future role checks (not used in v1). `404` for unknown archive ID. `413` for size cap. `502` for full TSA fallback chain failure (matches Phase 1 D-05 hard-fail).

### Configuration
- **D-25:** New env vars introduced in Phase 2 (added to docker-compose + README):
  - `API_KEY` (required)
  - `SESSION_SECRET` (required, ≥32 bytes)
  - `ADMIN_PASSWORD` (required)
  - `MANIFEST_DB_PATH` (default: `/data/manifest.sqlite`)
  - `MAX_UPLOAD_BYTES` (default: `104857600` — exposed for ops override but documented as "leave alone unless you also adjust Caddy")
- **D-26:** Phase 1's startup warning (`"⚠ Phase 1 has no auth — DO NOT expose port 3000"`) is removed in Phase 2 once auth ships. Replaced with a startup log confirming auth is active.

### Claude's Discretion (planner decides)
- Hono middleware factoring (one file vs split per concern), exact Alpine.js component structure, vendored Alpine version, CSS framework (or none), Drizzle migration file naming, the precise slugging algorithm for ZIP filenames, log format for backfill skips, the exact wording of German error messages (D-23 codes are locked; copy can be polished), the path layout of the static assets directory, how the legal-framing paragraphs in `VERIFY.template.md` are worded (must hit the four sections in D-16; exact prose is editorial).
- Test strategy: integration tests against a running server + tmp bundle dir are expected; the planner picks the framework split (vitest is already in `package.json`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project requirements + roadmap
- `.planning/REQUIREMENTS.md` — UPLOAD-01, UPLOAD-02, UPLOAD-03, SEC-01, SEC-02 (Phase 2 requirements); LEGAL-01 (referenced for VERIFY.md framing)
- `.planning/ROADMAP.md` §"Phase 2: HTTP API + Web Upload" — goal + 5 success criteria
- `.planning/PROJECT.md` — core value statement, constraints
- `.planning/STATE.md` §"Accumulated Context > Decisions" — stack decisions (Hono, Drizzle, better-sqlite3 confirmed)

### Phase 1 carry-over (the engine this phase wraps)
- `.planning/phases/01-core-archive-engine/01-CONTEXT.md` — D-03 (existing `POST /api/upload` shape), D-05 (hard-fail TSA semantics), D-11 (manifest deferred to Phase 2 — this phase delivers it), D-12 (`metadata.json` schema mirrored by D-19), D-13 (label field), D-14 (source_ip via X-Forwarded-For)
- `.planning/phases/01-core-archive-engine/01-SKELETON.md` — Walking Skeleton record
- `.planning/phases/01-core-archive-engine/01-VERIFICATION.md` — what's actually shipped
- `src/server.ts`, `src/routes/upload.ts`, `src/lib/bundle.ts`, `src/lib/metadata.ts`, `src/lib/tsa.ts` — the live code Phase 2 extends

### Stack research
- `.planning/research/STACK.md` — Hono + Drizzle + better-sqlite3 rationale, Alpine.js choice for frontend
- `.planning/research/ARCHITECTURE.md` — bundle layout (relevant for ZIP contents in D-14)
- `.planning/research/PITFALLS.md` — busboy / multipart edge cases, cookie attribute pitfalls
- `.planning/research/FEATURES.md` — Phase 2 feature breakdown
- `CLAUDE.md` — tech stack reference; `archiver` library entry covers the ZIP streaming decision (D-15)

### Deployment context (read before planning Caddy/Cloudflare touchpoints)
- User-global skill `~/.claude/skills/unraid-server/SKILL.md` — Cloudflare Tunnel + Caddy-Central publish path. Phase 2 does NOT change this (D-22 keeps size enforcement in-app), but the planner should confirm no Caddy config change is implied by any decision.

### External (fetch when planning)
- Hono middleware patterns: https://hono.dev/middleware/builtin
- Hono file upload: https://hono.dev/examples/file-upload
- busboy `limits.fileSize` behavior: https://github.com/mscdex/busboy#busboy-methods
- archiver streaming: https://www.archiverjs.com/docs/quickstart
- Drizzle ORM + better-sqlite3: https://orm.drizzle.team/docs/get-started-sqlite#better-sqlite3
- Alpine.js core: https://alpinejs.dev/start-here
- § 286 ZPO (German Code of Civil Procedure, free evaluation of evidence) — for VERIFY.md framing in D-16
- eIDAS Regulation Art. 41–42 (Zeitstempel) — for the qualified-vs-non-qualified note in D-16

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- `src/server.ts` — `createApp()` factory; Phase 2 mounts new middleware + routes here. The startup auth-warning (D-26) is removed here.
- `src/routes/upload.ts` — the existing `POST /api/upload` handler. Phase 2 wraps it with API-key middleware and updates the response shape to also return the manifest row's ID (it already returns ULID).
- `src/lib/bundle.ts` — bundle writer (used by download endpoint to locate files on disk via the manifest's `bundle_dir`).
- `src/lib/metadata.ts` — `metadata.json` schema; the Drizzle table in D-19 mirrors it; backfill (D-20) parses files produced by this module.
- `src/lib/sourceIp.ts` — X-Forwarded-For handling already in place (Phase 1 D-14); reused unchanged.
- `vitest` already configured (`pnpm test`); test patterns established in Phase 1.

### Established Patterns
- Hono app factory pattern (`createApp()`) — extend, do not replace.
- Bundle directory naming = ULID (Phase 1 D-08).
- All TS files use ESM imports with `.js` extensions (per `"type": "module"` in package.json).
- Error responses in Phase 1 are ad-hoc JSON — Phase 2 standardizes them via D-23.

### Integration Points
- **Bind-mounted volume** (Unraid host path) — bundles dir AND new `manifest.sqlite` both live here (D-25 default `/data/manifest.sqlite`). Docker compose volume mapping must be confirmed/extended.
- **Cloudflare Tunnel + Caddy-Central** — already publishing the container externally (Phase 1 verified deploy). Phase 2 changes nothing on this layer (size enforced in-app per D-22).
- **iOS Shortcut + n8n** — primary external API consumers; both need the `X-API-Key` header support and stable JSON error envelope (D-23).

</code_context>

<specifics>
## Specific Ideas

- VERIFY.md should explicitly tell the reader: "Diese Datei beweist, dass die Originaldatei zum angegebenen Zeitpunkt unverändert existiert hat — sie beweist nicht die Urheberschaft." (Integrity + time-of-existence, not authorship — this is the load-bearing legal nuance.)
- The slugger for D-13 should strip German umlauts in a readable way (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`) before falling through to `[^a-z0-9]+ → -`.
- Backfill log line format: `[backfill] indexed N entries, skipped M broken bundles in {duration}ms` — keep it one line for grep.
- The `Cache-Control: no-store` on the download endpoint is intentional — these bundles are evidentiary, do not let intermediaries cache them.

</specifics>

<deferred>
## Deferred Ideas

- **Per-source API keys + revocation table** → v2 (introduce when a key is shared with a third party that needs independent rotation)
- **i18n / bilingual VERIFY.md (DE+EN)** → v2 (when the archive needs to be shared with non-German-speaking parties)
- **Server-side session table** → v2 (only needed if multiple devices need to be revoked independently)
- **Login rate limiting / lockout** → v2 (acceptable for family scale; revisit if exposed more widely)
- **Per-user accounts on browser** → not planned (single-tenant by design)
- **CSRF token infrastructure** → only if a session-authenticated cross-origin POST surface ever lands
- **OpenTimestamps anchoring** → v2 (EXT-01)
- **Rclone backup of archive volume + manifest.sqlite** → v2 (EXT-02)
- **TSA retry queue** → v2 (EXT-03, already deferred from Phase 1)

</deferred>

---

*Phase: 02-http-api-web-upload*
*Context gathered: 2026-05-17*
