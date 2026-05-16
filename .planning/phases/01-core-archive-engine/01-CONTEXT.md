# Phase 1: Core Archive Engine - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers the cryptographic core of auto-archive: a Dockerized Node.js service that accepts a file via unauthenticated HTTP POST, computes its SHA-256, obtains an RFC 3161 timestamp (DFN → FreeTSA → DigiCert), and writes a complete tamper-proof bundle (`original.<ext>`, `original.sha256`, `original.tsq`, `original.tsr`, `tsa-cacert.pem`, `metadata.json`, `verify.sh`) to a bind-mounted Unraid volume. The container starts via `docker-compose up`; no data is stored inside the container; nothing else (auth, web form, ZIP download, browser, SQLite manifest) is in scope.

</domain>

<decisions>
## Implementation Decisions

### TSA library + RFC 3161 handling
- **D-01:** Use OpenSSL CLI via `execFile` (`openssl ts -query`, `openssl ts -reply`-parsing, `openssl ts -verify`) for all RFC 3161 work in the running service. **Rationale:** STATE.md decision; same binary that powers `verify.sh` powers the service — one verification path everyone can audit. Resolves the PKI.js-vs-OpenSSL conflict between CLAUDE.md and STATE.md in favor of STATE.md.
- **D-02:** Docker base image must include `openssl` (already present in `node:22-bookworm-slim`). Do not switch to Alpine.

### Entry interface
- **D-03:** Phase 1 ships a Hono HTTP server with `POST /api/upload` accepting `multipart/form-data` (file + optional `label` field). **No authentication in Phase 1** — Phase 2 layers the API-key middleware on top of the same endpoint.
- **D-04:** No separate CLI binary in Phase 1. (`verify.sh` shipped inside each bundle is the only CLI surface.)

### TSA failure semantics
- **D-05:** Hard-fail when DFN, FreeTSA, AND DigiCert all fail in the same request. Return a non-2xx response (4xx for client retriable, 5xx for server). **Write nothing to disk** — no partial bundles, no `tsa_status=pending`. Invariant: every directory on the Unraid volume is a fully-timestamped bundle.
- **D-06:** A persistent retry queue for failed timestamps is explicitly deferred to v2 (EXT-03).

### Bundle layout + immutability
- **D-07:** Apply `chmod 444` to every file in the bundle directory after the bundle is complete (atomic finalize step). Do not use `chattr +i` (Unraid XFS support is uncertain, and the RFC 3161 hash + timestamp already provide the tamper proof).
- **D-08:** Directory naming uses ULID (per STATE.md prior decision). One ULID directory per archived submission.

### verify.sh
- **D-09:** `verify.sh` performs the **full chain**: recompute SHA-256 of `original.<ext>`, compare to `original.sha256`, then run `openssl ts -verify -in original.tsr -data original.<ext> -CAfile tsa-cacert.pem`. Exit 0 only if both checks pass; print a clear pass/fail message.
- **D-10:** Every bundle must include `tsa-cacert.pem` matching whichever TSA actually signed the response (`metadata.json.tsa_provider`). Service holds the CA cert for each configured TSA and copies the correct one into each bundle.

### SQLite manifest
- **D-11:** **No SQLite manifest in Phase 1.** Filesystem bundles are the only state. Phase 2 introduces the manifest (Drizzle + better-sqlite3) when the API/browser need it; Phase 2 will backfill on first run by scanning the bundle directory.

### metadata.json contents (Phase 1)
- **D-12:** `metadata.json` schema for Phase 1: `id` (ULID), `original_filename`, `mime_type`, `size_bytes`, `sha256`, `created_at` (server UTC ISO 8601 — META-01), `label` (string, optional — META-02), `source_ip` (string — META-03), `tsa_provider` (`"dfn"` | `"freetsa"` | `"digicert"`), `tsa_status` (`"verified"` — only state written in Phase 1, per D-05), `tsa_attested_at` (timestamp extracted from TSR), `tsa_fallback_chain` (array of providers tried in order, e.g. `["dfn","freetsa"]` if DFN failed).
- **D-13:** `label` arrives as an optional `label` field in the `multipart/form-data` body. Defaults to `original_filename` if omitted. (Multipart form field chosen over header: idiomatic for file+metadata uploads, no header length concerns, native support in iOS Shortcut and n8n.)
- **D-14:** `source_ip` is read from `X-Forwarded-For` (first value, per Cloudflare/Caddy conventions) with fallback to the direct socket address. Hono must be configured with the appropriate trust-proxy behavior. (Aware: until Phase 2 puts Cloudflare Tunnel in front, this will record the direct caller — acceptable for Phase 1 testing.)

### Claude's Discretion
- Specific Hono router structure, file-stream pipeline details, OpenSSL subprocess error-handling shape, TSA timeout values, and the exact ULID library are left to the planner/researcher. Constraint: the timeout per TSA call must be short enough that a full fallback chain (3 TSAs) completes within a reasonable upload deadline (suggested budget: ~10s per TSA, ≤30s total — planner can refine).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project requirements + roadmap
- `.planning/REQUIREMENTS.md` — CORE-01..04, SEC-03, META-01..03 (Phase 1 requirements)
- `.planning/ROADMAP.md` §"Phase 1: Core Archive Engine" — goal + 5 success criteria
- `.planning/PROJECT.md` — core value statement, constraints, key decisions table
- `.planning/STATE.md` §"Accumulated Context > Decisions" — stack + TSA order + storage decisions (authoritative; supersedes the conflicting PKI.js entry in CLAUDE.md tech stack)

### Stack research (Phase 1-relevant)
- `.planning/research/STACK.md` — Node 22 + TS + Hono rationale, OpenSSL CLI vs PKI.js trade-off, Drizzle/SQLite for later phases
- `.planning/research/ARCHITECTURE.md` — bundle layout, TSA fallback order, file storage conventions
- `.planning/research/PITFALLS.md` — Alpine vs Debian Docker base, OpenSSL TSR parsing gotchas, TSA quirks
- `.planning/research/FEATURES.md` — Phase-mapped feature breakdown
- `.planning/research/SUMMARY.md` — domain-wide synthesis

### Project conventions
- `CLAUDE.md` — project tech stack reference (note: PKI.js entry is superseded by D-01; otherwise authoritative)

### External (no in-repo cache — fetch when planning)
- FreeTSA service docs: https://www.freetsa.org/index_en.php
- DFN-PKI Zeitstempel FAQ: https://doku.tid.dfn.de/de:dfnpki:zeitstempeldienst:faq
- OpenSSL `ts` command: https://docs.openssl.org/3.2/man1/openssl-ts/
- RFC 3161: https://datatracker.ietf.org/doc/html/rfc3161

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — empty codebase (no `src/`, no `package.json` yet). Phase 1 is greenfield.

### Established Patterns
- Project planning conventions (`.planning/`, GSD workflow, ROADMAP/REQUIREMENTS/STATE pattern) already in place.
- Unraid Docker deployment pattern documented in user's global skills (`unraid-server` skill in `~/.claude/skills/`) — bind-mounted volumes, Cloudflare Tunnel + Caddy-Central reverse proxy is the standard publish path (relevant in Phase 2, not Phase 1).

### Integration Points
- Bind-mounted volume at a host path on Unraid (192.168.178.30) is the only external integration in Phase 1.
- TSA endpoints (DFN, FreeTSA, DigiCert) are reached over the container's network — must verify outbound HTTPS works through the Unraid Docker default bridge before declaring Phase 1 done (per STATE.md blocker note).

</code_context>

<specifics>
## Specific Ideas

- `metadata.json` field naming should stay in `snake_case` to match other ecosystem tools (rfc3161 toolchain conventions).
- TSA CA certs (`tsa-cacert.pem` per provider) should ship as committed files inside the repo (e.g., `assets/tsa-certs/dfn.pem`, `freetsa.pem`, `digicert.pem`) rather than fetched at runtime — fetching defeats the offline-verification guarantee.

</specifics>

<deferred>
## Deferred Ideas

- API-key authentication on `POST /api/upload` → Phase 2 (SEC-01)
- Web upload form → Phase 2 (UPLOAD-02)
- Download ZIP bundle with VERIFY.md legal framing → Phase 2 (UPLOAD-03)
- SQLite manifest index + Drizzle schema → Phase 2 (needed by browser in Phase 3, but cheaper to introduce alongside the API)
- TSA retry queue for `tsa_status=pending` bundles → v2 (EXT-03)
- `chattr +i` immutability experiment on Unraid XFS → v2 only if a real threat model emerges
- OpenTimestamps / Bitcoin anchor → v2 (EXT-01)
- Rclone backup of archive volume → v2 (EXT-02)
- LEGAL-01 § 286 ZPO disclaimer in `VERIFY.md` → Phase 2 (where the download bundle is built)

</deferred>

---

*Phase: 1-core-archive-engine*
*Context gathered: 2026-05-17*
