<!-- GSD:project-start source:PROJECT.md -->
## Project

**auto-archive**

Ein selbst gehostetes System zur automatisierten, gerichtssicheren Archivierung von Dateien aller Art — mit RFC 3161 Zeitstempeln und SHA-256 Integritätsprüfung. Dateien können per iOS Shortcut, n8n-Webhook oder Web-Upload eingereicht werden und landen manipulationssicher auf dem eigenen Unraid-Server. Für Lennart und Familie/kleines Team.

**Core Value:** Jede archivierte Datei muss kryptografisch beweisbar zum Zeitpunkt der Einreichung existiert haben und unverändert geblieben sein — ohne Abhängigkeit von kostenpflichtigen Drittanbieter-Diensten.

### Constraints

- **Budget**: Kostenlos — nur FreeTSA/DFN-TSA (keine kostenpflichtigen TSA-Dienste in v1)
- **Hosting**: Unraid-Server (Docker Container), extern via Cloudflare Tunnel erreichbar
- **Verfügbarkeit**: Abhängig von freetsa.org / DFN — kein SLA, Fallback auf lokales Hashing falls TSA nicht erreichbar
- **Rechtlich**: RFC 3161 / eIDAS-konform — für deutsche Gerichte akzeptierte Methode
- **Sicherheit**: Dateien enthalten potenziell sensitive Beweismittel — Zugriff muss auth-geschützt sein
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Runtime
### Web Framework
### RFC 3161 Timestamping
### SHA-256 Hashing
### Frontend
### Database
### Containerization
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
- `crypto` — SHA-256 hashing, timing-safe comparison
- `fs/promises` + `fs.createReadStream` — file I/O
- `path` — path manipulation
- `fetch` — HTTP POST to TSA endpoints (stable in Node 22)
- `stream/promises` — `pipeline()` for streaming writes
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
### Additional fallback: rfc3161.ai.moda
## File Storage Layout
## What NOT to Use
### Not: Python / FastAPI
### Not: OpenSSL CLI subprocesses from Node.js
### Not: Node.js Alpine Docker image
### Not: Express.js
### Not: React/Vue/Svelte for the frontend
### Not: MinIO / S3-compatible object storage
### Not: `timestamp-trusted` npm (v1.0.4, 6 years unmaintained)
### Not: `node-forge` for ASN.1 / PKI
## Key Findings
## Installation
# Runtime dependencies
# Dev dependencies
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
