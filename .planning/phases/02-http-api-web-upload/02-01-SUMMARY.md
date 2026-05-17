---
phase: 02-http-api-web-upload
plan: "01"
subsystem: utilities
tags:
  - slug
  - session-cookie
  - error-envelope
  - config
  - verify-template
dependency_graph:
  requires:
    - Phase 1 types (src/types.ts — Metadata interface)
  provides:
    - slugifyLabel (src/lib/slug.ts)
    - signSessionCookie / verifySessionCookie (src/lib/sessionCookie.ts)
    - errorResponse / registerErrorEnvelope / ErrorCode (src/middleware/errorEnvelope.ts)
    - loadConfig / AppConfig (src/lib/config.ts)
    - renderVerifyMd (src/lib/verifyTemplate.ts)
    - assets/verify-template.md (German D-16 VERIFY.md template)
  affects:
    - All Wave 2 plans consume these leaf utilities (02-02 through 02-05)
tech_stack:
  added: []
  patterns:
    - UMLAUT_MAP + slugify pipeline (D-13)
    - HMAC-SHA256 base64url signed cookie with timingSafeEqual (D-02)
    - ErrorBody envelope {error:true, code, message} (D-23)
    - required() helper + fail-fast loadConfig (D-06)
    - REPO_ROOT via fileURLToPath(import.meta.url) + fs.readFileSync at module init (WR-05)
key_files:
  created:
    - src/lib/slug.ts
    - src/lib/sessionCookie.ts
    - src/middleware/errorEnvelope.ts
    - src/lib/config.ts
    - src/lib/verifyTemplate.ts
    - assets/verify-template.md
    - tests/unit/slug.test.ts
    - tests/unit/sessionCookie.test.ts
    - tests/unit/config.test.ts
    - tests/unit/verifyTemplate.test.ts
  modified: []
decisions:
  - "sessionCookie uses dotIndex split instead of .split('.') to handle base64url body that may contain dots in edge-cases — defensive against malformed cookies"
  - "verifyTemplate loads template synchronously at module init (readFileSync) matching bundle.ts pattern — avoids async startup complexity for a static asset"
  - "config.ts loadConfig() is a plain function (not a singleton) — env mutation in tests is easier; callers cache the result in deps bag"
metrics:
  duration: "4 minutes"
  completed_date: "2026-05-17"
  tasks_completed: 2
  files_created: 10
  tests_added: 25
---

# Phase 2 Plan 01: Pure Utility Modules + Global Error Envelope Summary

**One-liner:** HMAC-SHA256 session cookies, D-13 German umlaut slugger, D-23 JSON error envelope, fail-fast loadConfig, and D-16 German VERIFY.md template — five pure leaf modules ready for Wave 2 consumption.

## What Was Built

### Task 1: Slug + SessionCookie + ErrorEnvelope

**src/lib/slug.ts** — `slugifyLabel(label)` per D-13
- UMLAUT_MAP: ä→ae, ö→oe, ü→ue, Ä→ae, Ö→oe, Ü→ue, ß→ss
- Pipeline: umlaut fold → lowercase → `/[^a-z0-9]+/g → "-"` → trim leading/trailing dashes → `slice(0, 60)` → fallback `"archive"` if empty
- 7 unit tests covering umlaut fold, case-insensitive uppercase, empty fallback, symbols-only fallback, length cap, dash trimming, non-German accented chars

**src/lib/sessionCookie.ts** — HMAC-SHA256 signed browser session cookie per D-02
- Format: `base64url(json).base64url(hmac-sha256)`
- `signSessionCookie(payload, secret)`: creates signed cookie value
- `verifySessionCookie(cookie, secret)`: decodes, verifies MAC via `timingSafeEqual` (length pre-check), rejects expired payloads
- 7 unit tests: round-trip, tampered body, tampered MAC, expired, missing dot, wrong secret, source-level timingSafeEqual assertion

**src/middleware/errorEnvelope.ts** — D-23 global error envelope per D-23
- `ErrorCode` union: UNAUTHORIZED | FILE_TOO_LARGE | INVALID_REQUEST | TSA_UNAVAILABLE | NOT_FOUND | INTERNAL_ERROR
- `ErrorBody` interface: `{error: true, code: ErrorCode, message: string}`
- `errorResponse(c, status, code, message)` → `c.json<ErrorBody>(...)`
- `registerErrorEnvelope(app)` installs `notFound` (404/NOT_FOUND) and `onError` (500/INTERNAL_ERROR) handlers with German messages

### Task 2: loadConfig + VERIFY.md Template + renderVerifyMd

**src/lib/config.ts** — fail-fast env validation per D-06
- `required(name)` helper throws `Error("Missing required env var: ${name}")` on empty/missing
- `loadConfig()` validates API_KEY, SESSION_SECRET (≥32 bytes), ADMIN_PASSWORD; provides defaults for MANIFEST_DB_PATH (/data/manifest.sqlite), DATA_DIR (cwd/data), MAX_UPLOAD_BYTES (104857600)
- 7 unit tests covering happy path, missing API_KEY, empty SESSION_SECRET, short SESSION_SECRET, default MANIFEST_DB_PATH, default MAX_UPLOAD_BYTES, parsed MAX_UPLOAD_BYTES

**assets/verify-template.md** — German VERIFY.md template per D-16/D-17
- 4 required sections: `## Was ist das?`, `## Wie prüfen`, `## Rechtlicher Rahmen`, `## TSA-Vertrauensquelle`
- Tokens: `{{id}}`, `{{original_filename}}`, `{{sha256}}`, `{{tsa_provider}}`, `{{tsa_attested_at}}`
- § 286 ZPO legal framing, RFC 3161 mechanics, eIDAS note, DFN→FreeTSA→DigiCert fallback chain documentation
- Load-bearing sentence: "Diese Datei beweist, dass die Originaldatei zum angegebenen Zeitpunkt unverändert existiert hat — sie beweist nicht die Urheberschaft."

**src/lib/verifyTemplate.ts** — template renderer per D-16/D-17
- `REPO_ROOT` pattern via `fileURLToPath(import.meta.url)` (WR-05)
- `fs.readFileSync` at module init — static asset, synchronous load
- `renderVerifyMd(meta)` substitutes all 5 tokens via `replaceAll`
- 4 unit tests: all tokens + load-bearing sentence + section headings, § 286 ZPO, RFC 3161 + eIDAS, no `{{...}}` remaining

## Test Results

| Test File | Tests | Result |
|-----------|-------|--------|
| tests/unit/slug.test.ts | 7 | PASS |
| tests/unit/sessionCookie.test.ts | 7 | PASS |
| tests/unit/config.test.ts | 7 | PASS |
| tests/unit/verifyTemplate.test.ts | 4 | PASS |
| **Total new tests** | **25** | **all green** |

All existing Phase 1 tests also pass (42/43 — the container-smoke test failure is pre-existing and unrelated to this plan; it requires a Docker smoke script that the container environment doesn't provide in this context).

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: slug + sessionCookie + errorEnvelope | a974a78 | 5 files (3 src + 2 tests) |
| Task 2: loadConfig + verify-template + renderVerifyMd | 630d6d5 | 5 files (2 src + 1 asset + 2 tests) |

## Deviations from Plan

**None — plan executed exactly as written.**

The implementation followed the PATTERNS.md pattern assignments verbatim. The `sessionCookie.ts` uses `cookie.indexOf(".")` + slice instead of `cookie.split(".")` to be defensive against pathological inputs with multiple dots, but the behavior is identical for all valid cookies.

## Security / Threat Model Compliance

| Threat ID | Disposition | Implemented |
|-----------|-------------|-------------|
| T-02-01 (Spoofing: sessionCookie.verify) | mitigate | timingSafeEqual on MAC + length pre-check + expiry rejection |
| T-02-02 (Tampering: sessionCookie) | mitigate | HMAC-SHA256 with SESSION_SECRET ≥32 bytes enforced in loadConfig |
| T-02-03 (Info Disclosure: errorEnvelope.onError) | mitigate | onError returns "Unbekannter Fehler." only; stack to console.error |
| T-02-05 (DoS: loadConfig fail-fast) | mitigate | throws before port bind; index.ts pattern calls process.exit(1) |

## Known Stubs

None — all five modules are complete implementations with no placeholder values.

## Threat Flags

None — these are pure utility modules with no new network endpoints, auth paths, or file access patterns beyond what is documented in the plan's threat model.

## Self-Check: PASSED

Files exist:
- src/lib/slug.ts: FOUND
- src/lib/sessionCookie.ts: FOUND
- src/middleware/errorEnvelope.ts: FOUND
- src/lib/config.ts: FOUND
- src/lib/verifyTemplate.ts: FOUND
- assets/verify-template.md: FOUND
- tests/unit/slug.test.ts: FOUND
- tests/unit/sessionCookie.test.ts: FOUND
- tests/unit/config.test.ts: FOUND
- tests/unit/verifyTemplate.test.ts: FOUND

Commits verified:
- a974a78: Task 1 commit (found in git log)
- 630d6d5: Task 2 commit (found in git log)
