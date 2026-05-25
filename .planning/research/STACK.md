# Technology Stack — veritas

**Project:** Self-hosted tamper-proof file archiving with RFC 3161 timestamps
**Researched:** 2026-05-16
**Overall confidence:** HIGH for core stack, MEDIUM for TSA reliability

---

## Recommended Stack

### Core Runtime

**Node.js 22 LTS (TypeScript 5.x)**

Use Node.js, not Python/FastAPI. Rationale: RFC 3161 timestamp operations require binary ASN.1 handling, HTTP POST of binary blobs, and SHA-256 streaming — the Node.js `crypto` module covers all three natively with no external dependencies. Python's `rfc3161-client` (Trail of Bits) had a CVE in 2025 (CVE-2025-52556: insufficient verification of timestamp response signatures), which is disqualifying for a tamper-proof archive. Node.js crypto is the OS/OpenSSL binding directly. TypeScript gives you type safety on the archive metadata structures without a separate language ecosystem to maintain on Unraid.

### Web Framework

**Hono.js v4 (on Node.js adapter)**

Use Hono, not Express or Fastify. Rationale: Hono is TypeScript-first with deep type inference out of the box — no `@types/express` bolted on. File upload via `c.req.parseBody()` with multipart/form-data is built-in, no multer dependency needed. The `bodyLimit` middleware handles upload size caps in one line. Benchmarks show 3x throughput vs Express and lower memory than Fastify for small APIs. For a project with ~10 endpoints on a home server, this matters less for performance than for DX — and Hono's DX wins clearly in greenfield TypeScript. The official docs at hono.dev have working file upload examples for Node.js specifically.

### RFC 3161 Timestamping

**PKI.js v3.x + asn1js v3.x (PeculiarVentures)**

Use PKI.js for all RFC 3161 ASN.1 operations. It is the reference pure-JavaScript PKI library, actively maintained (latest publish: March 2026, 2 months before this research). It implements `TimeStampReq`, `TimeStampResp`, `MessageImprint`, and all supporting types against RFC 3161 directly. No native binaries, works in Node.js without OpenSSL CLI.

For the actual HTTP transport to the TSA: use Node.js built-in `fetch` (Node 22 has stable fetch). POST the `.tsq` binary as `application/timestamp-query` and receive the `.tsr` response. No special library needed.

**Do NOT use `openssl ts` CLI subprocess calls from Node.js.** Shell-escaping binary data across stdin/stdout is fragile, error-prone, and creates a surface for injection bugs. PKI.js does this in-process.

### SHA-256 Hashing

**Node.js built-in `crypto` module — no external package**

`crypto.createHash('sha256')` piped through `fs.createReadStream()` handles any file size without loading it into memory. This is stdlib, no npm dependency, auditable. The output hex string is your `.sha256` sidecar file. Use `crypto.timingSafeEqual()` for verification comparisons.

Do NOT use `js-sha256`, `sha256`, or similar npm packages — they are pure JS reimplementations of what the C crypto binding already does faster and more reliably.

### Frontend

**Alpine.js v3 + plain HTML (no build step)**

Use Alpine.js, served as a static file from the same Hono process. Rationale: the archive browser needs dynamic behavior (search/filter, file list pagination, modal for verification details) but has no reason for React/Vue/Svelte component trees and their build pipelines. Alpine.js is 7.1 kB gzipped, drops directly into HTML via `<script src="...">`, and has no build step — meaning the Docker image stays simple and the frontend is auditable as plain HTML. The "no build step" constraint is critical for a self-hosted tool that should be maintainable without a Node.js dev environment.

For CSS: use Tailwind CDN (play.tailwindcss.com CDN for dev, copy specific utilities into a small CSS file for production) or pico.css — a classless semantic CSS framework (< 10 kB) that makes forms and tables look decent without any CSS authoring.

### Database

**SQLite via Drizzle ORM (better-sqlite3)**

The file manifest (what files are archived, metadata per file, SHA-256, TSR path) needs queryable storage. The filesystem-only approach (reading all `metadata.json` files per request) does not scale past ~500 entries without noticeable latency. SQLite with `better-sqlite3` is synchronous, zero-config, single-file, and trivially backed up. Drizzle ORM gives TypeScript types for the schema without the migration complexity of Prisma.

The actual archive files (original + .sha256 + .tsq + .tsr) remain on the filesystem. SQLite stores only the manifest/index. This matches the project's "Dateisystem-Lösung auf Unraid" decision.

### Containerization

**`node:22-bookworm-slim` Docker base image**

Use Debian bookworm slim, not Alpine. Reasons:
1. Node.js Alpine images are marked "experimental" by the official Node.js Docker team, built from source rather than pre-built binaries.
2. bookworm-slim ships with OpenSSL already present (needed for PKI.js's WebCrypto backend), glibc (required for better-sqlite3 native bindings), and is a stable foundation.
3. Size difference between Alpine and bookworm-slim for Node.js is negligible (both ~200 MB) for this use case on a home server.

Multi-stage build: `node:22-bookworm-slim` for build stage (compile TypeScript, install dependencies including native modules), `node:22-bookworm-slim` for runtime stage (copy only dist/ and node_modules production deps).

---

## Libraries

| Library | Version | Purpose | Why This One |
|---------|---------|---------|-------------|
| `hono` | ^4.x | HTTP server, routing, file upload | TypeScript-first, built-in multipart, no multer needed |
| `@hono/node-server` | ^1.x | Node.js adapter for Hono | Required to run Hono on Node.js (not edge) |
| `pkijs` | ^3.4 | RFC 3161 TimeStampReq/Resp ASN.1 | Reference PKI library, actively maintained, pure JS |
| `asn1js` | ^3.x | ASN.1 BER/DER encode/decode (pkijs dep) | Required by pkijs, same author |
| `drizzle-orm` | ^0.30 | ORM for SQLite schema + queries | TypeScript types, lightweight, no runtime magic |
| `drizzle-kit` | ^0.20 | Migration CLI for Drizzle | Dev dependency only |
| `better-sqlite3` | ^9.x | SQLite driver (synchronous) | Synchronous API fits archive workflow, no async callback overhead |
| `@types/better-sqlite3` | ^7.x | TypeScript types | — |
| `zod` | ^3.x | Runtime validation of upload metadata | Type-safe request body parsing, integrates with Hono validators |
| `archiver` | ^7.x | ZIP bundle generation (download bundle) | Stream ZIP without temp files, widely used |
| `alpinejs` | ^3.x | Frontend reactivity (served as static) | No build step, 7 kB, sufficient for archive browser |

**Node.js built-ins used directly (no npm package needed):**
- `crypto` — SHA-256 hashing, timing-safe comparison
- `fs/promises` + `fs.createReadStream` — file I/O
- `path` — path manipulation
- `fetch` — HTTP POST to TSA endpoints (stable in Node 22)
- `stream/promises` — `pipeline()` for streaming writes

---

## TSA Configuration

### Primary TSA: FreeTSA (freetsa.org)

- **Endpoint:** `https://freetsa.org/tsr`
- **CA cert:** `https://freetsa.org/files/cacert.pem`
- **TSA cert:** `https://freetsa.org/files/tsa.crt`
- **Algorithm:** ECC P-384 (secp384r1), valid through February 2040 (updated March 2026)
- **Rate limits:** Not documented. The "do not abuse" note implies no hard throttle but polite use expected. For a family-scale archive (< 100 submissions/day) this is not an issue.
- **Reliability:** No SLA. Service has been running for years. Treat as best-effort.

### Secondary TSA: DFN (zeitstempel.dfn.de)

- **Endpoint:** `http://zeitstempel.dfn.de`
- **Authority:** Deutsches Forschungsnetz (DFN) — German academic network infrastructure
- **Legal standing:** DFN-PKI is on the German trust list, meaning timestamps carry stronger institutional credibility for German courts than FreeTSA
- **Use:** Fall back to DFN if FreeTSA times out. Request both in parallel and store whichever responds first; store both if both respond.
- **Reliability:** No public SLA, but DFN infrastructure is maintained by a national research organization. More stable than FreeTSA in practice.

### Fallback behavior

If both TSAs are unreachable: record the SHA-256 hash + timestamp in metadata.json with `tsa_status: "pending"`, return 202 Accepted to the client, and retry in the background on the next startup or via a cron job. Never silently drop a file.

### Additional fallback: rfc3161.ai.moda

A load-balanced proxy over multiple trusted TSAs (Adobe Trust List). Handles millions of requests/month with automatic failover. Use as tertiary fallback. Not on EU trust list but functionally reliable.

---

## File Storage Layout

```
/archive/
  {YYYY}/{MM}/{DD}/
    {ulid}/                  # ULID-based directory (sortable, no collision)
      original.{ext}         # original file, unchanged
      original.sha256        # hex SHA-256 of original file
      original.tsq           # DER-encoded timestamp request
      original.tsr           # DER-encoded timestamp response (token)
      metadata.json          # submitter, IP, note, timestamps, tsa_url, tsa_status
```

Use ULID (not UUID4) for directory names — ULIDs are lexicographically sortable by creation time, which makes `ls -1 | sort` useful and simplifies chronological queries without touching the database.

**Append-only enforcement:** After writing all files in an archive entry, apply `chattr +i` on the directory and its contents. This prevents modification even by root. The Docker container does NOT need `CAP_LINUX_IMMUTABLE` by default — set it via `--cap-add LINUX_IMMUTABLE` in the Unraid Docker template when immutability is desired. The immutable flag is the defense-in-depth layer; the cryptographic proof (hash + TSR) is the primary tamper evidence.

Note: `chattr` only works on ext2/ext3/ext4 and partially on XFS. Unraid's array uses XFS (supports `i` flag) or Btrfs. Verify filesystem type before enabling in production.

---

## What NOT to Use

### Not: Python / FastAPI

The `rfc3161-client` Python library from Trail of Bits had CVE-2025-52556 (insufficient verification of timestamp response signatures). For a tamper-proof archive, using a library with a known crypto verification bug — even if patched — introduces audit liability. Node.js crypto bindings to OpenSSL have no equivalent published CVE in this area. If you are more comfortable in Python, wait until rfc3161-client has multiple patched releases and a clean audit; for v1 today, Node.js is the safer choice.

### Not: OpenSSL CLI subprocesses from Node.js

`child_process.exec('openssl ts -query ...')` requires piping binary data through shell, managing temp files, parsing stderr for errors, and handling platform differences. PKI.js does the same work in-process, synchronously, with TypeScript types. Use PKI.js.

### Not: Node.js Alpine Docker image

Experimental support, source-compiled, no guarantee of binary compatibility with native modules (`better-sqlite3`). Use bookworm-slim.

### Not: Express.js

Express 4.x requires external multer for file uploads, has no native TypeScript types (requires @types/express), and has a middleware ecosystem with inconsistent maintenance. Express 5.x was just released but has low community uptake as of this research. Hono covers the same use case with less ceremony.

### Not: React/Vue/Svelte for the frontend

A build pipeline (Vite, webpack, etc.) for a private family-facing archive browser creates maintenance overhead with no benefit. Alpine.js + static HTML is deployable as `COPY dist/ /app/public` in the Dockerfile. No `npm run build` step needed for the frontend.

### Not: MinIO / S3-compatible object storage

Explicitly out of scope per PROJECT.md. Filesystem + Docker volume is correct for v1.

### Not: `timestamp-trusted` npm (v1.0.4, 6 years unmaintained)

Do not use. Abandoned package based on a PHP port. PKI.js is the correct choice.

### Not: `node-forge` for ASN.1 / PKI

node-forge is a general-purpose crypto library; its ASN.1 implementation is functional but not purpose-built for RFC 3161. PKI.js implements the RFC 3161 types directly and is more correct. node-forge is appropriate for TLS/certificate generation tasks, not timestamp token parsing.

---

## Key Findings

1. **RFC 3161 in Node.js is well-solved by PKI.js v3.** The library is maintained by PeculiarVentures, implements `TimeStampReq`/`TimeStampResp` directly, and requires no OpenSSL binary. The actual HTTP transport to the TSA is 10 lines with `fetch`.

2. **FreeTSA updated its certificate to ECC P-384 in March 2026** (valid until 2040). No hard rate limit documented; family-scale use is safe. DFN is a stronger fallback for German courts because it is on the national PKI trust list.

3. **SHA-256 hashing in Node.js requires zero npm dependencies.** `crypto.createHash('sha256')` with `fs.createReadStream()` is the correct pattern for any file size.

4. **Hono.js is the right TypeScript framework** for this size and scope. Built-in multipart, Zod integration, no legacy middleware debt, strong TypeScript DX.

5. **SQLite + filesystem hybrid** is the correct storage model. Files on disk, manifest in SQLite. Pure-filesystem approaches (reading all `metadata.json` per request) degrade at ~500+ entries. SQLite with Drizzle adds < 1 day of setup time and resolves the search/filter requirement cleanly.

6. **Alpine.js with no build step** is the correct frontend approach for a self-hosted tool that needs to stay maintainable by one person without a dev environment setup.

7. **`chattr +i` tamper prevention** works on Unraid's XFS filesystem (the `i` flag is supported). Requires `CAP_LINUX_IMMUTABLE` in the Docker container. Apply after writing all sidecar files for an archive entry.

8. **ULID over UUID4** for archive entry identifiers: lexicographically sortable, collision-free, does not expose creation timestamp in a guessable way.

---

## Installation

```bash
# Runtime dependencies
npm install hono @hono/node-server pkijs asn1js drizzle-orm better-sqlite3 zod archiver ulid alpinejs

# Dev dependencies
npm install -D typescript @types/node @types/better-sqlite3 drizzle-kit tsx
```

---

## Sources

- PKI.js npm (last publish March 2026): https://www.npmjs.com/package/pkijs
- PKI.js RFC 3161 API: https://pkijs.org/docs/api/classes/TimeStampReq/
- FreeTSA service details: https://www.freetsa.org/index_en.php
- DFN Timestamp Service: https://doku.tid.dfn.de/de:dfnpki:zeitstempeldienst:faq
- List of free RFC 3161 servers: https://gist.github.com/Manouchehri/fd754e402d98430243455713efada710
- rfc3161-client CVE: https://github.com/advisories/GHSA-6qhv-4h7r-2g9m
- Hono file upload docs: https://hono.dev/examples/file-upload
- Node.js crypto docs: https://nodejs.org/api/crypto.html
- OpenSSL ts command: https://docs.openssl.org/3.2/man1/openssl-ts/
- chattr append-only pattern: https://thelinuxcode.com/chattr-and-lsattr-in-linux-practical-file-immutability-append-only-logs-and-safer-ops-with-real-examples/
- Node.js Docker image variants: https://hub.docker.com/_/node/
- Alpine.js: https://alpinejs.dev/
