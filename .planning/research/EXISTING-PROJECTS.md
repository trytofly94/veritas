# Existing Projects: Self-Hosted Tamper-Proof File Archiving with RFC 3161

**Researched:** 2026-05-16
**Question:** Are there existing open-source projects we can build on instead of from scratch?
**Verdict:** BUILD — No directly usable foundation exists. Borrow patterns and libraries; assemble from parts.

---

## Directly Usable Projects

Projects that could be deployed as-is or forked as a foundation. Evaluated on: RFC 3161 support, Docker, web UI, upload endpoint, n8n compatibility, activity.

### None Found

No single project covers the full requirement profile:
- File upload endpoint (REST, multipart, API-key auth)
- RFC 3161 timestamping of arbitrary files (not just PDFs or git commits)
- Structured per-file archive layout (original + hash + .tsq + .tsr + metadata.json)
- Browser frontend (list, search, verify)
- Download bundle (ZIP with verify script)
- Docker image for Unraid

The closest approximations are paperless-tsa (shell script, paperless-ngx dependency) and sigstore/timestamp-authority (a TSA server, not an archiving system). Neither is a foundation for what auto-archive needs.

---

## Libraries to Use

### Node.js / TypeScript

| Library | Stars | License | Last Release | Verdict | Notes |
|---------|-------|---------|-------------|---------|-------|
| `pdf-rfc3161` | 2 | MIT | Jan 2026 (v0.1.4) | Reference Only | PDF-specific; zero deps; pure TS; browser + edge compatible. Not general-purpose. |
| `@xevolab/timestamping-token` | 0 | MIT | Dec 2023 | Avoid | Zero stars, no community, stale. Implements TSA server-side, not client. |
| `timestamp-trusted` | — | — | 6 years ago | Avoid | Dead. PHP port. No maintenance. |

**Node.js gap:** There is no well-maintained, general-purpose RFC 3161 *client* library for Node.js that handles arbitrary file hashing and TSA request/response. The OpenSSL CLI (`openssl ts`) called via `child_process` is the most reliable path — it ships with every Linux container and handles the full TSP flow.

### Python

| Library | Stars | License | Last Release | Verdict | Notes |
|---------|-------|---------|-------------|---------|-------|
| `rfc3161-client` (Trail of Bits) | 7 | Apache-2.0 | Apr 2026 (v1.0.6) | Borrow From | Rust core + Python bindings via PyO3. Actively maintained. Correct protocol. Deliberately no network layer. Best Python option if going Python. |
| `rfc3161ng` | 44 | MIT | Apr 2023 | Reference Only | Python 3 supported. Moderate stars. Last commit 2023 — not dead but slow. Simpler API than Trail of Bits. |
| `tsp-client` (pyauth) | 8 | MIT | Dec 2024 | Reference Only | Pure Python IETF TSP client. Low adoption but technically correct. |

**Python gap:** If the stack is Python, Trail of Bits `rfc3161-client` is the pick. But the project description implies Node.js / TypeScript stack (n8n, Docker ecosystem). Python is viable but creates a language mismatch.

### Shell / OpenSSL (canonical approach)

The most referenced, cross-language approach for RFC 3161 in self-hosted contexts is OpenSSL's built-in `ts` subcommand:

```bash
# Generate hash + timestamp request
openssl ts -query -data "$FILE" -sha256 -cert -out "$FILE.tsq"

# Submit to TSA
curl -s -S -H "Content-Type: application/timestamp-query" \
  --data-binary @"$FILE.tsq" https://freetsa.org/tsr -o "$FILE.tsr"

# Verify
openssl ts -verify -data "$FILE" -in "$FILE.tsr" -CAfile freetsa-ca.pem
```

OpenSSL is available in every Alpine/Debian container. No library dependency. Output is standard `.tsq`/`.tsr` files readable by any RFC 3161-compliant tool. This is what paperless-tsa, rfcts, and GitTrustedTimestamps all use under the hood.

**Recommendation:** Use OpenSSL CLI called via Node.js `child_process.execFile()` or a thin shell wrapper. This avoids the unmaintained npm library problem entirely.

---

## Reference Implementations

Projects that demonstrate patterns, approaches, or architecture worth studying — but not building on directly.

### paperless-tsa (Butanal)

- **URL:** https://github.com/Butanal/paperless-tsa
- **Stars:** 2 | **License:** Apache-2.0 | **Language:** Shell
- **What it does:** Post-consumption hook for paperless-ngx. Calls FreeTSA for each uploaded document, stores `.tsr` alongside original. Includes `timestamp_all.sh` for retroactive batch timestamping.
- **Relevance:** Exact same TSA flow (OpenSSL + FreeTSA + .tsr storage) that auto-archive needs. The shell approach is the proof-of-concept template for the timestamping module.
- **Why not build on:** It is a paperless-ngx sidecar, not a standalone service. No web UI, no API, no metadata, no verification endpoint. 2 stars.
- **Rating: Reference Only** — steal the OpenSSL invocation pattern verbatim.

### GitTrustedTimestamps (mabuware)

- **URL:** https://github.com/mabuware/GitTrustedTimestamps
- **Stars:** 46 | **License:** MIT | **Language:** Shell
- **What it does:** Post-commit hook that adds RFC 3161 + RFC 5816 timestamp tokens to git repositories. Supports multiple TSAs, LTV data, chain validation.
- **Relevance:** Demonstrates chained timestamps and LTV (long-term validation) approach. The Medium article by Matthias Bühlmann ("Git as Cryptographically Tamperproof File Archive using Chained RFC3161 Timestamps") is the definitive reference for the tamper-evident chain model.
- **Why not build on:** Git-repository-centric. Requires git as storage layer. No REST API, no web UI.
- **Rating: Reference Only** — the chaining + LTV concepts are valuable for a v2 feature, but out of scope for v1.

### rfcts (makew0rld)

- **URL:** https://github.com/makew0rld/rfcts
- **Stars:** 3 | **License:** Unlicense | **Language:** Shell
- **What it does:** Minimal bash scripts: `timestamp` (creates .tsr) and `verify` (verifies .tsr). Accepts stdin. Uses DigiCert by default, configurable.
- **Relevance:** Clean, minimal reference for the two-command RFC 3161 flow. Source is public domain.
- **Rating: Reference Only** — read the source before writing the timestamping module.

### sigstore/timestamp-authority

- **URL:** https://github.com/sigstore/timestamp-authority
- **Stars:** 131 | **License:** Apache-2.0 | **Language:** Go
- **Last Release:** v2.0.6 (Apr 2026) — actively maintained
- **What it does:** A production-grade RFC 3161 TSA *server*. Issues timestamps. Integrates with Rekor transparency log. Docker Compose included.
- **Relevance:** This is what FreeTSA runs (or something similar). Demonstrates the server side. Could theoretically self-host a TSA, eliminating FreeTSA dependency.
- **Why not build on:** auto-archive is a TSA *client*, not a server. Running a TSA server adds infrastructure complexity without legal benefit (a self-signed TSA has no third-party trust value for court purposes).
- **Rating: Reference Only** — confirms FreeTSA/DFN-TSA are the right call; self-hosting a TSA is overkill for v1.

### uts-server (kakwa)

- **URL:** https://github.com/kakwa/uts-server
- **Stars:** 80 | **License:** MIT | **Language:** C
- **What it does:** Micro RFC 3161 TSA server written in C. ReadTheDocs documentation, 314 commits, active CI.
- **Relevance:** Same category as sigstore/timestamp-authority. Lightweight C alternative if self-hosting a TSA.
- **Rating: Reference Only** — same reasoning as above; not needed for v1.

### Bellingcat Auto Archiver

- **URL:** https://github.com/bellingcat/auto-archiver
- **Stars:** 1,100 | **License:** MIT | **Last Release:** v1.2.7 (Apr 2026) | **Docker:** Yes
- **What it does:** Automated web content archiving for journalists/researchers. Modular pipeline: fetch URLs → enrich (hash, transcript) → store (S3, Google Drive). CSV/Google Sheets input.
- **Relevance:** Architecture pattern for modular enrichment pipeline is conceptually similar to auto-archive's intake → hash → timestamp → store flow.
- **Relevant gap:** No RFC 3161 timestamping. URL-centric (not arbitrary file upload). Google Sheets input model is incompatible with the webhook/iOS Shortcut use case.
- **Rating: Reference Only** — architecture inspiration only; the modular enricher pipeline pattern is worth noting.

### paperless-ngx (RFC 3161 status)

- **URL:** https://github.com/paperless-ngx/paperless-ngx
- **What it does:** Full document management system. OCR, tagging, full-text search, web UI. Docker-first. 21,000+ stars.
- **RFC 3161 status:** Feature request open (Discussion #10617), closed due to insufficient votes. No native RFC 3161 support. Community workaround = paperless-tsa shell script.
- **Why not build on:** Massive dependency (OCR, database, Redis, Celery). Designed for document management, not tamper-proof evidence archiving. RFC 3161 is a patch on top, not a first-class feature. Adds 5+ containers.
- **Rating: Avoid** — heavyweight, wrong problem domain, RFC 3161 is an afterthought.

### Mayan EDMS

- **URL:** https://www.mayan-edms.com/
- **RFC 3161 status:** GPG signatures supported; RFC 3161 not found in feature docs. Issue #941 (include time of document signature) closed.
- **Why not build on:** Even heavier than paperless-ngx. Enterprise document management. No RFC 3161.
- **Rating: Avoid** — wrong problem domain.

### ArchiveBox

- **URL:** https://github.com/ArchiveBox/ArchiveBox
- **Stars:** 22,000+ | **License:** MIT
- **What it does:** Self-hosted web archiving. Saves URLs to HTML, PDF, WARC, screenshots. Docker-first.
- **Relevance:** Zero. URL-centric web archiving, not file integrity/timestamping. No RFC 3161.
- **Rating: Avoid** — completely different use case despite "archiving" in the name.

---

## Free TSA Services Assessment

Based on the community gist (https://gist.github.com/Manouchehri/fd754e402d98430243455713efada710):

| Service | Trust Level | Notes |
|---------|-------------|-------|
| `https://freetsa.org/tsr` | Untrusted (no commercial trust list) | Established, free, used by many OSS projects. No SLA. Adequate for v1. |
| `http://zeitstempel.dfn.de` | Trusted (DFN = German research network) | More authoritative than FreeTSA for German legal context. Recommended as primary for auto-archive. |
| `http://timestamp.digicert.com` | Adobe Trust List | Commercial but free tier. High uptime. Good fallback. |
| `http://timestamp.sectigo.com` | Adobe Trust List | Same tier as DigiCert. Good fallback. |

**Recommendation:** Use DFN-TSA as primary (German legal context), FreeTSA as secondary fallback, DigiCert as tertiary. Store which TSA was used in metadata.json per entry.

---

## n8n Integration Assessment

No n8n community node or template for RFC 3161 file timestamping exists. This is a custom integration.

n8n's native webhook node:
- Supports `multipart/form-data` for file uploads
- Supports custom header authentication (X-API-Key pattern)
- 16 MB default payload limit (configurable via `N8N_PAYLOAD_SIZE_MAX`)
- n8n already runs on Lennart's Unraid server

**Pattern:** n8n webhook → HTTP Request node → auto-archive upload endpoint. The n8n side is a generic HTTP call, no custom node needed. The relevant n8n template is "Creating a Secure Webhook" (https://n8n.io/workflows/5174-creating-a-secure-webhook-must-have/).

---

## iOS Shortcut Assessment

No pre-built iOS Shortcut template for RFC 3161-aware file upload to a self-hosted server exists in the Shortcuts Gallery or community repositories.

iOS Shortcuts native capabilities relevant to auto-archive:
- "Get File" action — picks any file from Files app (including iCloud Drive, WhatsApp exports via share sheet)
- "Get Contents of URL" action — supports multipart/form-data POST with custom headers (X-API-Key)
- Share Sheet extension — allows auto-archive to be a share target from any app

The Shortcut build is straightforward: Get File → Set Variable (file, description note) → URL (multipart POST with API key header) → Show Result (archive ID from response). No template needed; standard Shortcuts primitives suffice.

---

## Recommendation: Build vs. Fork

**Verdict: Build from scratch, borrowing specific patterns.**

### Rationale

1. **No suitable foundation exists.** The closest project (paperless-tsa) is a 2-star shell script sidecar for a different application. There is no open-source project that combines: REST upload API + RFC 3161 timestamping of arbitrary files + structured archive layout + browser frontend + Docker.

2. **The core timestamping logic is simple.** OpenSSL's `ts` subcommand handles the full RFC 3161 flow in 3 lines of shell. The complexity is in the surrounding system (API server, storage, frontend, auth), which has no existing solution to inherit.

3. **Scope is narrow and specific.** auto-archive is purpose-built for a specific use case (tamper-proof evidence archiving for a family/small team on Unraid). General-purpose tools (paperless-ngx, Mayan EDMS) add massive overhead for features that are explicitly out of scope.

4. **Build time is low.** Given the simplicity of the TSA client logic and the clarity of the storage model (filesystem, structured directories), this is a 2-3 phase build, not a platform.

### What to Borrow

| Source | What to Steal |
|--------|--------------|
| paperless-tsa | OpenSSL `ts -query` / `ts -verify` invocation pattern |
| rfcts | Two-command timestamp/verify shell interface |
| GitTrustedTimestamps | LTV + chaining concept for v2 consideration |
| weisser-zwerg.dev blog | Verification workflow walkthrough for documentation |
| Bellingcat auto-archiver | Modular enrichment pipeline architecture concept |

### What NOT to Use as Foundation

| Project | Reason to Avoid |
|---------|----------------|
| paperless-ngx | Heavyweight, wrong domain, RFC 3161 is bolt-on |
| Mayan EDMS | Even heavier, no RFC 3161 |
| ArchiveBox | URL archiving, completely different |
| @xevolab/timestamping-token | 0 stars, stale, no community |
| timestamp-trusted npm | 6 years old, dead |

---

## Sources

- GitHub Topics rfc3161: https://github.com/topics/rfc3161
- paperless-ngx RFC 3161 discussion: https://github.com/paperless-ngx/paperless-ngx/discussions/10617
- paperless-tsa: https://github.com/Butanal/paperless-tsa
- GitTrustedTimestamps: https://github.com/mabuware/GitTrustedTimestamps
- Medium article on chained timestamps: https://medium.com/swlh/git-as-cryptographically-tamperproof-file-archive-using-chained-rfc3161-timestamps-ad15836b883
- rfcts bash scripts: https://github.com/makew0rld/rfcts
- rfc3161-client (Trail of Bits): https://github.com/trailofbits/rfc3161-client
- rfc3161ng: https://github.com/trbs/rfc3161ng
- sigstore/timestamp-authority: https://github.com/sigstore/timestamp-authority
- uts-server: https://github.com/kakwa/uts-server
- pdf-rfc3161: https://github.com/mingulov/pdf-rfc3161
- dnl50/tsa-server Docker: https://hub.docker.com/r/dnl50/tsa-server
- bellingcat/auto-archiver: https://github.com/bellingcat/auto-archiver
- Free TSA servers gist: https://gist.github.com/Manouchehri/fd754e402d98430243455713efada710
- OpenSSL trusted timestamping guide: https://weisser-zwerg.dev/posts/trusted_timestamping/
- n8n secure webhook template: https://n8n.io/workflows/5174-creating-a-secure-webhook-must-have/
