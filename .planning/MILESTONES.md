# Milestones

## v1.0 MVP (Shipped: 2026-05-18)

**Phases completed:** 3 phases, 10 plans, 12 tasks
**Git range:** initial commit (2026-05-16) → 6e46567 (2026-05-18)
**Volume:** 132 files, ~24 246 LOC across TypeScript + tests + planning docs
**Timeline:** 3 days

### Key Accomplishments

1. **Cryptographic archive core (Phase 1)** — SHA-256 hash + RFC 3161 timestamp pipeline; per-bundle directory layout (`original.*`, `metadata.json`, `verify.sh`); standalone `verify.sh` reproduces hash and TSR verification with zero runtime dependencies.
2. **TSA fallback chain (Phase 1)** — DFN-TSA primary → FreeTSA → DigiCert tertiary, with pre-finalization `openssl ts -verify` and all-fail → 502. `metadata.tsa_provider` records the actual signer; `tsa_fallback_chain` records the attempted chain.
3. **Hardened Docker on Unraid (Phase 1)** — node:22-bookworm-slim base, read-only rootfs, all caps dropped, no-new-privileges, tmpfs `/tmp`, uid 10001, port 3000 loopback. Live-verified on Unraid 192.168.178.30.
4. **Secured HTTP API (Phase 2)** — `POST /api/upload` with timing-safe X-API-Key gate, streaming multipart (busboy), SQLite manifest insert (Drizzle), and full D-23 error envelope. `GET /api/download/:id` streams an 8-file ZIP including VERIFY.md with § 286 ZPO legal framing.
5. **Browser upload + auth (Phase 2)** — Vendored Alpine.js + hand-authored CSS. HMAC-signed session cookie (HttpOnly; Secure; SameSite=Lax) gates `/archive*` pages; download accepts session OR API key.
6. **Archive browser (Phase 3)** — Server-rendered list page (filename, date, type, TSA badge) and detail page with all 9 metadata fields. Live "Integrität prüfen" button calls `POST /api/archive/:id/verify` which re-streams the original through SHA-256 and re-verifies the TSR.

### Validation

Live E2E via Chrome MCP + curl + DFN-TSA round-trip on 2026-05-18. 16/16 requirements satisfied. Iter-3 blocker B-3 (Alpine init race on archive-detail) closed by commit `87beef0`. Static post-fix re-audit accepted in lieu of a 4th live contrarian pass.

Known deferred items at close: 2 (stale audit artifacts — see STATE.md Deferred Items).

### Tech Debt Carried

- Phase 2: unconditional `Secure` cookie blocks plain-HTTP LAN login (`http://192.168.178.30:3000` documented in README). Gate on `COOKIE_SECURE` env var.
- Phase 2: `POST /api/upload` 201 response omits `tsa_provider` + `tsa_attested_at`, leaving the web-upload success card's TSA rows blank (cosmetic — detail page renders them correctly).
- Phase 3: `metadata.json` parsed via `as unknown as ArchiveDetailMeta` cast — no runtime field validation.
- Phase 3: `tsa_fallback_chain` typed as `string` (DB JSON-encoded) vs `string[]` (parsed metadata) — divergent-types trap, currently unrendered.
- Phase 1: 5 INFO-level deferred items (Math.random temp names, dash compat of verify.sh, .dockerignore, defensive ASN.1 index, engines.node).

### Archive

- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.0-REQUIREMENTS.md`
- `.planning/milestones/v1.0-MILESTONE-AUDIT.md`

---
