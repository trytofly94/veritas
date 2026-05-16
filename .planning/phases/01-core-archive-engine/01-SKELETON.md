# Walking Skeleton — auto-archive

**Phase:** 1
**Generated:** 2026-05-17

## Capability Proven End-to-End

A user running `curl -F file=@test.txt -F label=foo http://localhost:3000/api/upload` against a `docker-compose up` container on Unraid receives a 201 with a bundle ID and finds a ULID-named directory on the bind-mounted volume containing `original.<ext>`, `original.sha256`, `original.tsq`, `original.tsr`, `tsa-cacert.pem`, `metadata.json`, and `verify.sh` — and running `bash verify.sh` from inside that directory exits 0 with a success message.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 22 LTS (bookworm-slim) | STATE.md decision; native module + openssl binary support; Alpine rejected per D-02 |
| Language | TypeScript (strict) | CLAUDE.md stack; type-safe Hono integration |
| HTTP framework | Hono + `@hono/node-server` | D-03; multipart-native, no Express weight |
| RFC 3161 client | OpenSSL CLI via `node:child_process.execFile` | D-01; same binary as `verify.sh`, single audit path |
| Hash function | Node `crypto.createHash('sha256')` over `fs.createReadStream` | CLAUDE.md; streaming, no full file in memory |
| TSA order | DFN-TSA primary → FreeTSA fallback → DigiCert tertiary | D-12, STATE.md |
| TSA failure semantics | Hard-fail when all three TSAs fail; write nothing to disk | D-05 invariant |
| Bundle storage | Filesystem; one ULID directory per submission on bind-mounted Unraid volume | D-07, D-08, D-11 |
| Bundle immutability | `chmod 444` on every bundle file after atomic finalize; no `chattr +i` | D-07 |
| ULID library | `ulid` (npm) — leave specific lib to planner discretion, picked here for zero-dep simplicity | CONTEXT Discretion |
| Persistence layer (Phase 1) | None — filesystem is the only state | D-11 |
| CA cert distribution | Committed PEM files under `assets/tsa-certs/{dfn,freetsa,digicert}.pem`; copied into bundle | "Specific Ideas" — offline-verification guarantee |
| Deployment target | Docker container on Unraid (192.168.178.30) via `docker-compose up`; bind-mounted host volume for `/data` | Roadmap SC-5 |
| Directory layout | `src/` (TS source), `assets/tsa-certs/`, `assets/verify-template.sh`, `Dockerfile`, `docker-compose.yml`, `tsconfig.json`, `package.json`, `data/` (bind-mounted, gitignored) | Planner discretion under CONTEXT |
| Source IP resolution | `X-Forwarded-For` first value, fall back to socket address; Hono trust-proxy enabled | D-14 |
| `metadata.json` field naming | `snake_case` | "Specific Ideas" |

## Stack Touched in Phase 1

- [x] Project scaffold — `package.json`, `tsconfig.json` (strict), Hono server, `npm run dev` / `npm run start`
- [x] Routing — `POST /api/upload` (multipart/form-data)
- [x] "Data layer" — filesystem write (atomic temp-dir → rename → chmod 444) and bundle read for `verify.sh`
- [x] External integration — OpenSSL CLI subprocess + outbound HTTPS to DFN/FreeTSA/DigiCert
- [x] Deployment — `Dockerfile` (node:22-bookworm-slim) + `docker-compose.yml` bind-mounting `./data → /data`; runs on local Docker AND Unraid

## Out of Scope (Deferred to Later Slices)

- API-key authentication on `/api/upload` → Phase 2 (SEC-01)
- Web upload HTML form → Phase 2 (UPLOAD-02)
- ZIP download bundle with VERIFY.md / § 286 ZPO framing → Phase 2 (UPLOAD-03, LEGAL-01)
- SQLite manifest index (Drizzle + better-sqlite3) → Phase 2 (D-11)
- Archive browser UI → Phase 3
- TSA retry queue for transient failures → v2 (EXT-03)
- `chattr +i` immutability experiment → v2 only if threat model justifies
- OpenTimestamps Bitcoin anchor → v2 (EXT-01)
- Rclone backup of archive volume → v2 (EXT-02)
- Cloudflare Tunnel publish path → Phase 2

## Subsequent Slice Plan

Each later phase adds a vertical slice on top of this skeleton without altering the architectural decisions above:

- **Phase 2:** Layer API-key middleware on the existing `POST /api/upload`; add web upload form + ZIP download endpoint; introduce SQLite manifest (backfilled by scanning existing bundle directories); publish via Cloudflare Tunnel.
- **Phase 3:** Add password-protected browser UI listing entries from the SQLite manifest with a detail view per bundle.
