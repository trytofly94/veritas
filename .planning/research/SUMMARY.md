# Project Research Summary

**Project:** auto-archive
**Domain:** Self-hosted tamper-proof file archiving with RFC 3161 timestamps (German civil/labor law evidence use case)
**Researched:** 2026-05-16
**Confidence:** HIGH for stack and architecture, HIGH for features, MEDIUM for legal nuance

---

## Executive Summary

auto-archive is a purpose-built self-hosted evidence archiving system for a single household and small trusted group. It must produce cryptographically verifiable proof that a file existed at a specific moment and has not been modified since — suitable for submission in German civil and labor court proceedings. The system is deployed as a Docker container on an Unraid server, exposed via Cloudflare Tunnel, and accepts file submissions from iOS Shortcuts, n8n webhooks, and a web browser. No equivalent open-source project exists; this is a greenfield build assembling well-established parts.

The recommended stack is **Node.js 22 LTS + TypeScript + Hono.js**, with RFC 3161 timestamping handled by **OpenSSL CLI called via `child_process.execFile()`** — not PKI.js. This resolves the conflict between the Stack researcher (who recommended PKI.js) and the Existing Projects researcher (who found no viable Node.js RFC 3161 client library and explicitly recommended OpenSSL subprocess). OpenSSL ships in every Debian-based container, its output is byte-for-byte standard DER that courts and experts can independently verify, and every reference implementation in the wild uses it. PKI.js reimplements what OpenSSL already does correctly — there is no benefit to the added dependency. The Python option (FastAPI + rfc3161-client) is disqualified by CVE-2025-52556 in rfc3161-client and by the unnecessary language mismatch with the rest of the operator's infrastructure.

The primary legal risk is framing: RFC 3161 timestamps from FreeTSA are **not qualified** under eIDAS and do not carry the legal presumption of § 371a ZPO. They are strong supporting evidence under § 286 ZPO (freie Beweiswürdigung) and in practice German civil courts regularly admit them, but the system must never represent itself as producing court-presumed proof. The second concrete risk is Cloudflare's 100 MB upload cap, which will silently break large WhatsApp video exports. Both are fully manageable if addressed in Phase 1.

---

## Key Findings

### Build vs. Fork Decision

**Verdict: Greenfield build.** No usable foundation exists. The closest project (paperless-tsa) is a 2-star shell script sidecar for a different application. No open-source project combines: REST upload API + RFC 3161 timestamping of arbitrary files + structured archive layout + browser frontend + Docker. Build time is low because the core timestamping logic is 3 lines of OpenSSL and the storage model is a straightforward filesystem layout. Borrow the OpenSSL invocation pattern from paperless-tsa and rfcts verbatim.

### Recommended Stack

The stack resolves to a **single-language TypeScript monolith** with one carefully chosen subprocess dependency:

**Core technologies:**
- **Node.js 22 LTS + TypeScript 5.x** — runtime; built-in `crypto` and `fetch` cover hashing and TSA HTTP transport natively with no external deps
- **Hono.js v4 + @hono/node-server** — HTTP server; TypeScript-first, built-in multipart/form-data, `bodyLimit` middleware for upload cap enforcement, no multer needed
- **OpenSSL CLI via `child_process.execFile()`** — RFC 3161 TSQ generation and TSR verification; this is the correct resolution of the STACK.md vs EXISTING-PROJECTS.md conflict; do NOT use PKI.js for this role
- **Node.js built-in `crypto`** — SHA-256 streaming hash via `createHash('sha256')` piped to `createReadStream()`; zero npm deps
- **SQLite + Drizzle ORM (better-sqlite3)** — manifest/index for fast search; files remain on filesystem; single-file, zero-config, synchronous
- **Alpine.js v3 + plain HTML** — frontend with no build step; 7 kB; sufficient for archive browser
- **`node:22-bookworm-slim` Docker base** — NOT Alpine (Node.js Alpine images are experimental and lack native module support)

**What NOT to use:** PKI.js (no benefit over OpenSSL subprocess), Python/FastAPI (CVE in rfc3161-client, language mismatch), `exec()` with shell string (injection risk — use `execFile()` with argument array), React/Vue/Svelte (no build pipeline needed), MinIO, Express.js, `timestamp-trusted` npm (dead), `node-forge` (wrong tool for RFC 3161).

### TSA Strategy

**DFN-TSA as primary, FreeTSA as secondary, DigiCert as tertiary.**

This order is a deliberate reversal of the PROJECT.md default (FreeTSA-first):

- **DFN-TSA** (`http://zeitstempel.dfn.de`) — German research network, on national PKI trust list, higher credibility with German courts, free for non-commercial personal use. **Use as primary.**
- **FreeTSA** (`https://freetsa.org/tsr`) — no commercial trust list membership, no SLA, ECC P-384 cert valid until 2040. **Use as first fallback.**
- **DigiCert** (`http://timestamp.digicert.com`) — Adobe Trust List, high uptime, free. **Use as second fallback.**

**Dual-timestamp pattern:** Request DFN-TSA and FreeTSA in parallel; store whichever responds first; store both if both respond within the timeout window. This provides two independent cryptographic witnesses.

**Fallback behavior when all TSAs fail:** Store file + SHA-256, set `tsa_status: "pending"`, return 202, retry on next startup or background queue. Never reject an upload because TSA is unavailable.

**DFN usage constraint:** Non-commercial personal/family use only per DFN statutes. If the use case ever becomes commercial, replace DFN-TSA before that transition.

### Expected Features

**Must have (table stakes — Phase 1 and 2):**
- SHA-256 hash computed server-side on ingest via streaming
- RFC 3161 TSQ generated and TSR obtained; both stored (.tsq + .tsr)
- TSR cryptographically verified immediately after receipt (not just stored)
- Per-file metadata.json with: submitter, source IP, description, tsa_status, server time, TSA-attested time, tsa_provider
- Immutable filesystem permissions after write (chmod 444 on files, 555 on directory)
- API key auth for upload endpoints; password protection for browser UI
- Multipart POST /api/upload endpoint
- Download bundle: ZIP with original + .sha256 + .tsq + .tsr + metadata.json + tsa-cacert.pem + VERIFY.md
- VERIFY.md with OpenSSL verification commands and correct legal framing
- iOS Shortcut (Share Sheet → multipart POST with X-API-Key)
- n8n workflow (webhook → HTTP Request node)
- Audit log: every upload, download, verification attempt logged

**Should have (differentiators — Phase 3):**
- Archive browser: search by filename/description/tags/date range, cursor pagination
- In-browser verification: re-hash + re-verify TSR server-side with green/red status
- Background TSR retry queue for pending entries
- Duplicate detection: SHA-256 match warning on ingest
- Tag system: freeform tags per submission

**Defer to v2+:**
- QES / QTSP integration (D-Trust, Bundesdruckerei)
- LTV (Long-Term Validation) and chained timestamps
- OCR / full-text content indexing
- OpenTimestamps / blockchain anchoring
- Case management / evidence grouping

### Architecture Approach

**Single Docker Compose stack: one application container + one cloudflared sidecar.** No microservices, no separate database container. Hono.js process serves both the upload API and the browser frontend on the same port. SQLite is a file on the bind-mounted Unraid filesystem.

The ARCHITECTURE.md research used Python/FastAPI as its reference implementation. All architectural decisions (component boundaries, API design, file storage layout, Docker Compose structure, backup strategy) are correct and transfer directly to Node.js. Replace "FastAPI + Jinja2 + HTMX" with "Hono.js + Alpine.js + static HTML".

**Major components:**
1. **Upload API** — receives multipart file, streams SHA-256 hash, calls TSA client, writes archive entry, inserts manifest record
2. **TSA Client** — builds .tsq via `openssl ts -query -data <file> -sha256 -cert -out`, POSTs to TSA via `fetch`, saves .tsr, immediately verifies via `openssl ts -verify`
3. **Archive Storage** — `/data/archive/{YYYY}/{MM}/{DD}/{ulid}/` with ULID directory names for lexicographic sort
4. **Manifest Database** — SQLite + Drizzle ORM; queryable metadata index; SQLite FTS5 for search; rebuilt from filesystem if corrupted
5. **Archive Browser** — Hono routes serving Alpine.js HTML; server-side cursor pagination
6. **Cloudflare Tunnel** — cloudflared sidecar; routes `archive.lennart.de` → `http://auto-archive:8000`; no host ports exposed

### Critical Pitfalls

1. **OpenSSL subprocess injection** — use `child_process.execFile()` with argument array, never `exec()` with a template string. A filename with shell metacharacters in `exec()` is a command injection vector. This is non-negotiable for a security-sensitive system.

2. **TSR not verified after receipt (T3)** — always run `openssl ts -verify` immediately after storing the TSR. HTTP 200 from the TSA is not proof of a valid token. Log verification result in metadata.json. Mark `tsr_invalid` and retry with fallback TSA if verification fails.

3. **No `-cert` flag in TSQ (T1)** — always pass `-cert` to `openssl ts -query`. Without it the TSR does not embed the TSA signing certificate, making it unverifiable if the TSA rotates or disappears. Also bundle the current `tsa-cacert.pem` in every download ZIP.

4. **Cloudflare 100 MB upload cap (T7)** — all Cloudflare plans hard-cap proxied request bodies at 100 MB. Enforce this server-side via Hono `bodyLimit` with a clear JSON error. Document the LAN direct upload path for large files. Must be in Phase 1 before any client integration.

5. **Legal framing: FreeTSA is not a QTSP (L1)** — the system provides "advanced" not "qualified" timestamps. VERIFY.md and any UI copy must say: "This proves the file existed at the timestamp and has not changed since. It does not carry a legal presumption under § 371a ZPO." This framing must ship in Phase 2, not as a post-launch addition.

6. **chattr +i unreliable on Unraid XFS (O6)** — `chattr +i` may silently have no effect on XFS. Use `chmod 444` on files and `chmod 555` on the entry directory after write as the operational immutability control. The SHA-256 + TSR is the cryptographic proof. If WORM is needed: ZFS datasets with `zfs set readonly=on` (Unraid 6.12+).

7. **iOS Shortcut API key truncation (T8)** — keep API keys to 32 hex characters. Use `X-API-Key` header, not Authorization. iOS Shortcuts may silently truncate Base64-encoded Authorization headers at 76 characters (MIME line folding).

8. **Docker data not bind-mounted (O1)** — all archive data, SQLite database, and CA certs must be on bind-mounted Unraid volumes. Never write persistent data inside the container. Non-negotiable for a legal evidence system.

---

## Implications for Roadmap

### Phase 1: Core Archive Engine + Docker Foundation

**Rationale:** Everything depends on the timestamping pipeline working correctly end-to-end before any HTTP interface is layered on top. Docker scaffolding goes in Phase 1 (not Phase 4) because Unraid bind mount permissions and filesystem behavior are discovery risks that must surface immediately, not after building on a local dev environment.

**Delivers:**
- `sha256Hash(filePath)` — streaming Node.js crypto
- `buildTsq(sha256, outputPath)` — OpenSSL `ts -query` via execFile
- `requestTsr(tsqPath, tsaUrl, outputPath)` — fetch POST to TSA
- `verifyTsr(file, tsrPath, tsqPath, caCertPath)` — OpenSSL `ts -verify` via execFile
- `writeArchiveEntry(file, metadata)` — ULID directory, all sidecar files, chmod 444
- SQLite schema + Drizzle migrations for manifest
- Docker Compose with bind mounts, cloudflared sidecar, env vars
- Basic `POST /api/upload` testable via curl (no browser UI)
- TSA fallback chain: DFN → FreeTSA → DigiCert → pending queue with background retry

**Pitfalls addressed:** T1 (no -cert), T2 (algorithm mismatch), T3 (TSR unverified), T4 (no fallback), T5 (no .tsq stored), O1 (no bind mount), O3 (Unraid 6.10 permissions), O5 (API key handling)

**Research flag:** Standard patterns — no additional research needed. OpenSSL `ts` subcommand is well-documented; execFile pattern is standard Node.js.

### Phase 2: HTTP API + iOS/n8n Integration

**Rationale:** The archive engine exists; expose it properly and validate with real clients. The 100 MB limit must be enforced before any client is handed an API key. VERIFY.md legal framing must ship before any real file is archived for legal purposes.

**Delivers:**
- Complete `/api/*` route group: upload, status, bundle download, entry list, verify
- 100 MB body limit via Hono `bodyLimit` middleware with clear JSON error response
- X-API-Key auth middleware
- Download bundle: ZIP with original + all sidecars + VERIFY.md + tsa-cacert.pem
- VERIFY.md template with OpenSSL commands and correct § 286 ZPO legal framing
- iOS Shortcut: Share Sheet → multipart POST → notification with archive ID
- n8n workflow: HTTP Request node (multipart, X-API-Key header auth credential)
- Audit log: upload, download, verification events

**Pitfalls addressed:** T7 (CF 100 MB), T8 (iOS key truncation), T9 (iOS no status codes — return JSON body always), L1 (legal framing in VERIFY.md), L2 (DFN non-commercial constraint documented in README)

**Research flag:** Standard patterns. iOS multipart and n8n HTTP Request node patterns are well-documented in FEATURES.md.

### Phase 3: Archive Browser + Verification UI + Documentation

**Rationale:** The system is functional but only accessible via curl/Shortcuts. The browser transforms it from a pipeline into a product. Verification UI is required before handing the archive to a lawyer — the archive owner needs to confirm integrity interactively.

**Delivers:**
- `/browse/*` route group: entry list with search/filter, single entry detail, inline verification
- SQLite FTS5 search on filename, description, tags
- Server-side cursor pagination
- Per-entry in-browser verification: re-hash + re-verify TSR, green/red status, audit log entry
- Duplicate detection: SHA-256 match warning on ingest
- Tag system: freeform tags stored and indexed
- Background TSR retry queue for pending entries
- Certificate refresh: download and store current CA certs at startup
- User-facing legal documentation: what the system proves, what it does not, how to use the download bundle with a lawyer

**Pitfalls addressed:** L3 (chain of custody narrative), L4 (provenance vs integrity distinction in UI copy), T6 (certificate revocation awareness), O4 (backup strategy documented in operational runbook), O7 (server clock vs TSA time both recorded)

**Research flag:** Standard patterns — SQLite FTS5, Alpine.js reactivity, cursor pagination are all well-documented. No additional research needed.

### Phase Ordering Rationale

- **Docker in Phase 1, not Phase 4.** The ARCHITECTURE.md build order deferred Docker to Phase 4. This is wrong for this project. Unraid bind mount permissions (O3), XFS chattr behavior (O6), and bookworm-slim + OpenSSL availability must be validated before any logic is written against them.

- **Clients in Phase 2, not Phase 3+.** iOS Shortcuts and n8n are the primary submission paths for the actual use case. They must be validated against a real running server, not deferred as an integration layer.

- **Browser in Phase 3.** The archive owner can query via curl or the API until Phase 3. The browser is important UX but not a correctness requirement. Defer it until the core is solid.

- **Legal documentation in Phase 2 (VERIFY.md) and Phase 3 (full docs).** The VERIFY.md framing ships with the first real upload capability. In-app and README legal documentation is Phase 3.

### Research Flags

Needs deeper investigation during planning:
- **Phase 1 — OpenSSL ts -verify output parsing:** `execFile` with `openssl ts -verify` returns exit code 1 on failure; stderr messages are non-standard. Write a thin wrapper that parses the output correctly. Validate against paperless-tsa and rfcts source before implementing.
- **Phase 2 — Hono bodyLimit vs Cloudflare edge behavior:** Verify that Hono's bodyLimit middleware returns a client-readable JSON error *before* Cloudflare kills the connection with an opaque HTML 413. Requires integration test with a file >100 MB against the actual Cloudflare Tunnel.

Standard patterns (no additional research needed):
- **Phase 1 — SHA-256 streaming:** stdlib, no research needed
- **Phase 1 — SQLite + Drizzle schema:** standard CRUD, well-documented
- **Phase 2 — n8n HTTP Request node:** standard multipart pattern documented in FEATURES.md
- **Phase 3 — SQLite FTS5:** standard SQLite feature with Drizzle support

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | STACK.md sourced from official npm pages, Node.js docs, PKI.js docs. OpenSSL subprocess recommendation confirmed by EXISTING-PROJECTS.md survey of all available Node.js libraries. CVE in Python rfc3161-client is a documented advisory with GHSA ID. |
| Features | HIGH | Table stakes derived from RFC 3161 spec, German ZPO research, eIDAS Art. 41/42 sources. iOS/n8n patterns from official docs. Legal nuance (court discretion) is inherently MEDIUM. |
| Architecture | HIGH | Single-container pattern is correct for this scale. Component boundaries are clear. ARCHITECTURE.md was Python-targeted but all structural decisions transfer directly. |
| Pitfalls | HIGH | Most pitfalls have primary source corroboration: Cloudflare community thread (100 MB limit), Apple Discussions (Base64 truncation), Unraid forums (6.10 permissions), OpenSSL docs (algorithm flags). |

**Overall confidence:** HIGH

### Gaps to Address

- **FreeTSA rate limits:** Not documented. Family-scale use (<100 submissions/day) is safe by inference. Monitor in Phase 1 testing with real TSA requests.

- **DFN-TSA HTTP vs HTTPS:** The documented endpoint uses HTTP. Confirm whether TLS is available. HTTP transport does not invalidate the TSR (it is signed regardless) but tampering with the TSQ in transit could cause the TSA to timestamp a wrong hash. Test the endpoint in Phase 1.

- **DFN-TSA reachability from Docker on Unraid:** Confirm the endpoint is reachable from inside the container and returns valid TSRs before committing to it as primary.

- **chattr +i on Unraid XFS:** Test actual behavior on the project's filesystem in Phase 1 deployment. Default to chmod 444 as the immutability control regardless.

- **Hono bodyLimit + Cloudflare edge interaction:** Must be integration-tested in Phase 2 before handing out iOS Shortcut credentials.

---

## Sources

### Primary (HIGH confidence)
- RFC 3161 specification: https://datatracker.ietf.org/doc/html/rfc3161
- rfc3161-client CVE-2025-52556: https://github.com/advisories/GHSA-6qhv-4h7r-2g9m
- FreeTSA service details: https://www.freetsa.org/index_en.php
- DFN Timestamp Service FAQ: https://doku.tid.dfn.de/de:dfnpki:zeitstempeldienst:faq
- Hono.js file upload docs: https://hono.dev/examples/file-upload
- Node.js crypto docs: https://nodejs.org/api/crypto.html
- eIDAS legal admissibility: https://snapoena.com/blog/rfc-3161-timestamps-what-courts-accept
- Digital evidence under § 371a ZPO: https://truescreen.io/articles/digital-evidence-german-civil-procedure-zpo-371a-eidas/

### Secondary (MEDIUM confidence)
- OpenSSL RFC 3161 guided tour: https://weisser-zwerg.dev/posts/trusted_timestamping/
- Free TSA servers assessment: https://gist.github.com/Manouchehri/fd754e402d98430243455713efada710
- Cloudflare Tunnel 100 MB limit: https://community.cloudflare.com/t/100mb-tunnel-limit/901339
- paperless-tsa reference implementation: https://github.com/Butanal/paperless-tsa
- rfcts bash reference: https://github.com/makew0rld/rfcts
- n8n binary data handling: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- iOS Shortcuts Base64 truncation: https://discussions.apple.com/thread/251563782
- Unraid 6.10 permission change: https://forums.unraid.net/bug-reports/stable-releases/docker-permission-issues-unraid-610-r1986/

### Tertiary (context only)
- sigstore/timestamp-authority: https://github.com/sigstore/timestamp-authority
- GitTrustedTimestamps LTV/chaining: https://github.com/mabuware/GitTrustedTimestamps
- bellingcat/auto-archiver pipeline pattern: https://github.com/bellingcat/auto-archiver

---
*Research completed: 2026-05-16*
*Ready for roadmap: yes*
