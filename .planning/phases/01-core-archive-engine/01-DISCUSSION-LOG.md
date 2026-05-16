# Phase 1: Core Archive Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-17
**Phase:** 1-core-archive-engine
**Areas discussed:** TSA library + entry interface, TSA failure + bundle immutability, verify.sh scope + SQLite manifest, metadata.json label + source IP

---

## TSA library

| Option | Description | Selected |
|--------|-------------|----------|
| OpenSSL CLI via execFile (per STATE.md) | Use `openssl ts -query/-reply/-verify` subprocesses. Same binary for service AND verify.sh — one verification path. | ✓ |
| PKI.js for service, OpenSSL only in verify.sh | Pure-JS TS request/response handling for the service; verify.sh still uses openssl. Cleaner code, two verification implementations. | |
| Defer / discuss tradeoffs more | Mark as open for the researcher phase. | |

**User's choice:** OpenSSL CLI via execFile
**Notes:** Resolves the CLAUDE.md vs STATE.md conflict in favor of STATE.md. Docker base must keep `openssl` (already present in `node:22-bookworm-slim`).

---

## Phase 1 entry interface

| Option | Description | Selected |
|--------|-------------|----------|
| HTTP POST endpoint, no auth yet | Hono with POST /api/upload (no API key check). Phase 2 adds the auth middleware + web form. | ✓ |
| CLI binary only, HTTP comes in Phase 2 | `archive <file> --label X`. Invoked via docker exec. Phase 2 wraps with Hono. | |
| Both: CLI is the core, HTTP wraps it | Build archive op as a callable TS function used by both thin CLI and HTTP handler. | |

**User's choice:** HTTP POST endpoint, no auth yet
**Notes:** Matches Phase 1 success criterion #1 ("submitted via curl"). Phase 2 layers auth on the same endpoint without restructuring.

---

## TSA double-failure semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-fail: return error, write nothing | If no TSA responds, upload returns 5xx and no directory is created. Invariant: every bundle on disk is fully timestamped. | ✓ |
| Write bundle with tsa_status=pending | Store partial bundle for later retry. Partial bundles can leak into "archived" state. | |
| Hard-fail, but keep upload as a queued draft | Reject synchronously but persist file to quarantine for admin re-trigger. | |

**User's choice:** Hard-fail: return error, write nothing
**Notes:** A persistent retry queue is explicitly deferred to v2 (EXT-03).

---

## Bundle immutability

| Option | Description | Selected |
|--------|-------------|----------|
| chmod 444 only (no chattr) | Files written read-only via fs.chmod after bundle completion. Works on any FS. | ✓ |
| chmod 444 + try chattr +i, ignore if unsupported | Best-effort immutability with FS-detection fallback. | |
| Nothing for v1 | Rely on RFC 3161 hash+timestamp as the only tamper proof. | |

**User's choice:** chmod 444 only
**Notes:** RFC 3161 hash + timestamp is the load-bearing tamper proof; chmod is defense-in-depth.

---

## verify.sh scope

| Option | Description | Selected |
|--------|-------------|----------|
| Full chain: hash recompute + openssl ts -verify against pinned CA | Recompute SHA-256, then `openssl ts -verify -in original.tsr -data original.<ext> -CAfile tsa-cacert.pem`. Court-grade offline verification. | ✓ |
| Hash-only | Just recompute SHA-256 and compare. Faster, no openssl needed by verifier, but doesn't prove the TSR is valid. | |
| Two scripts: verify-hash.sh + verify-timestamp.sh | Split the concern. Quick hash check + full TSR chain check. | |

**User's choice:** Full chain
**Notes:** Bundle must include `tsa-cacert.pem` matching the TSA that actually signed (`metadata.json.tsa_provider`). Service ships per-provider CA certs as committed assets.

---

## SQLite manifest in Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| Build it now in Phase 1 | Add Drizzle + better-sqlite3 + manifest table. Larger Phase 1 surface. | |
| Defer to Phase 2 | Phase 1 writes filesystem bundles only. Phase 2 introduces manifest (backfill on first run by scanning dir). | ✓ |
| Defer to Phase 3 | Manifest only when browser needs it. Phase 2 also reads from filesystem. | |

**User's choice:** Defer to Phase 2
**Notes:** Keeps Phase 1 minimal. Schema design decisions move to Phase 2 alongside the API.

---

## metadata.json — label arrival

| Option | Description | Selected |
|--------|-------------|----------|
| Multipart form field 'label' | Client sends `label=...` alongside file. Optional, defaults to filename. | ✓ (Claude's choice) |
| Header (X-Archive-Label) | Header-based instead of form field. | |
| Stub with hardcoded value | metadata.json always records `label='phase1-bootstrap'`. | |

**User's choice:** "you decide was besser ist perspektivisch" — Claude chose multipart form field
**Notes:** Multipart form field is idiomatic for file+metadata uploads, no header length concerns, native support in iOS Shortcut and n8n. Headers reserved for auth tokens (Phase 2).

---

## metadata.json — source IP capture

| Option | Description | Selected |
|--------|-------------|----------|
| Capture from HTTP request (X-Forwarded-For, fallback to socket) | Read X-Forwarded-For first (Cloudflare/Caddy proxy), fall back to socket. | ✓ |
| Capture only the direct socket address | Ignore proxy headers in Phase 1. | |

**User's choice:** X-Forwarded-For with socket fallback
**Notes:** Aware that until Phase 2 puts Cloudflare Tunnel in front, the recorded IP will be the direct caller — acceptable for Phase 1 testing.

---

## Claude's Discretion

- Multipart form field for `label` (user explicitly delegated)
- Hono router structure, file-stream pipeline shape, OpenSSL subprocess error-handling, exact ULID library
- TSA timeouts (suggested budget: ~10s per TSA, ≤30s total for full fallback)
- Internal layout of `src/` and how `tsa-cacert.pem` files are bundled into the Docker image

## Deferred Ideas

- API-key auth → Phase 2 (SEC-01)
- Web upload form → Phase 2 (UPLOAD-02)
- Download ZIP bundle + VERIFY.md legal framing → Phase 2 (UPLOAD-03, LEGAL-01)
- SQLite manifest + Drizzle → Phase 2
- TSA retry queue → v2 (EXT-03)
- `chattr +i` experiment → v2 (only if threat model justifies)
- OpenTimestamps → v2 (EXT-01)
- Rclone backup → v2 (EXT-02)
