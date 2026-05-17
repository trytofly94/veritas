# Phase 2: HTTP API + Web Upload — Discussion Log

**Date:** 2026-05-17
**Mode:** discuss (default, single-pass batched questions)

## Area Selection

Question: Which gray areas to discuss?
Options presented: Auth model / Web upload UX / Download bundle + VERIFY.md / Manifest + limits + errors
User selected: **all four**

## Area 1 — Auth model

Question: API key storage + browser session model for a family-scale single-Unraid deployment.
Options:
1. **Env-var key + signed cookie** (Recommended) — single `API_KEY`, HMAC-signed session cookie, single `ADMIN_PASSWORD`.
2. Hashed keys table + SQLite sessions.
3. Multiple labeled env-var keys.

User selected: **#1 (env-var key + signed cookie)** → D-01..D-06

Follow-up captured: D-11 documents the trade-off of injecting the API key into the static upload page (page = credential, gated by Cloudflare + family-only access). Planner flagged with a fallback path if this feels wrong on review.

## Area 2 — Web upload UX

Question: Form architecture, JS, language.
Options:
1. **Single HTML page, Alpine.js, drag-drop + progress, DE** (Recommended)
2. Server-rendered form, no JS progress.
3. Same as #1 + DE/EN i18n toggle.

User selected: **#1** → D-07..D-11

Notes: Alpine.js vendored (not CDN) to keep container self-contained on Unraid. UI German only.

## Area 3 — Download bundle + VERIFY.md

Question: ZIP naming, contents, VERIFY.md framing.
Options:
1. **`{label}-{ULID}.zip`, full bundle, VERIFY.md in DE** (Recommended)
2. `{ULID}.zip`, full bundle, VERIFY.md DE+EN.
3. `{label}-{ULID}.zip`, minimal bundle (no verify.sh).

User selected: **#1** → D-12..D-17

Notes: VERIFY.md sections locked (Was ist das / Wie prüfen / Rechtlicher Rahmen / TSA-Vertrauensquelle). § 286 ZPO + RFC 3161 + eIDAS-Anlehnung framing. Slugger handles umlauts (specifics).

## Area 4 — Manifest + limits + error shape

Question: Schema, backfill trigger, size cap enforcement, error envelope.
Options:
1. **Drizzle mirror + startup backfill + busboy 100MB + JSON error envelope** (Recommended)
2. Lazy backfill (per-request).
3. Caddy-level size enforcement + Hono fallback.

User selected: **#1** → D-18..D-24

Notes: Sync startup backfill acceptable at family scale. Error codes locked (D-23), German messages, 401/403 split (D-24). Bundle+row write order with orphan cleanup (D-21).

## Configuration consequences
- Three new required env vars: `API_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD` (D-25).
- Two new optional: `MANIFEST_DB_PATH`, `MAX_UPLOAD_BYTES`.
- Startup-fail invariant if required env vars are missing (D-06).
- Remove Phase 1 startup auth-warning (D-26).

## Deferred (captured, not in scope)
- Per-source API keys + revocation, hashed keys table, server-side sessions
- i18n (bilingual VERIFY.md), DE/EN UI toggle
- Login rate limiting, CSRF token infrastructure, per-user accounts
- OpenTimestamps anchoring (EXT-01), rclone backup (EXT-02), TSA retry queue (EXT-03)
