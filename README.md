# Veritas

Self-hosted, court-grade file archive. Every submitted file is hashed
(SHA-256) and timestamped via RFC 3161 (DFN → FreeTSA → DigiCert fallback)
into a tamper-proof bundle on a bind-mounted volume. A password-protected
browser UI lists every entry, shows full metadata, and verifies integrity
on demand. Download bundles ship as ZIPs with a self-contained verifier
and a German legal framing (`VERIFY.md`, § 286 ZPO).

**Submission paths:** iOS Shortcuts, n8n, curl (all via `X-API-Key`), or
the browser web form (session login).

**Milestone v1.0 status:** all 16 requirements satisfied, all 5 E2E flows
wired, all 3 phases verified — see `.planning/v1.0-MILESTONE-AUDIT.md`.

> **Auth is mandatory.** `/api/upload` requires `X-API-Key`; `/archive*`
> and `/api/archive/*/verify` require a session cookie from `POST /login`.
> `GET /api/download/:id` accepts either. The compose file binds port 3700
> to **loopback only** by default — put any external exposure behind
> Cloudflare Tunnel (or another authenticated reverse proxy).

## Prerequisites

- Docker 24+ with the Compose v2 plugin (`docker compose ...`)
- `openssl` on the host (used by `verify.sh` against any produced bundle)
- `curl` on the host for ad-hoc submissions (optional)
- A `.env` file or shell environment with `API_KEY`, `SESSION_SECRET`,
  `ADMIN_PASSWORD` set (see [Configuration](#configuration))

## Quickstart (local Docker)

```sh
# 1. Provide secrets (or rely on the smoke-test defaults baked into compose).
cat > .env <<'EOF'
API_KEY=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=$(openssl rand -base64 24)
EOF

# 2. Build + start.
docker compose up -d --build

# 3. Health check.
curl -s http://127.0.0.1:3700/health
# → {"ok":true}

# 4. Submit a file via the API.
curl -H "X-API-Key: $(grep '^API_KEY=' .env | cut -d= -f2)" \
  -F file=@tests/fixtures/hello.txt -F label=smoke \
  http://127.0.0.1:3700/api/upload
# → 201 {"id":"01J…","bundle_path":"/data/01J…"}

# 5. Browse via the web UI.
open http://127.0.0.1:3700           # upload form (API key injected from server)
open http://127.0.0.1:3700/login     # session login
open http://127.0.0.1:3700/archive   # browse all entries
```

### File ownership

Files written into `./data` on the host are owned by **uid 10001** — the
non-root `app` user inside the container (Threat T-03-01 mitigation). If
you need a different owner (e.g. Unraid's default `nobody:users` = `99:100`):

```sh
sudo chown -R 99:100 ./data
```

This is cosmetic only; the cryptographic guarantees are independent of
filesystem ownership.

### Automated smoke test

```sh
bash scripts/smoke-container.sh        # raw shell — exits 0 on success
npm test -- --run tests/e2e/container-smoke.test.ts   # vitest wrapper
```

The script tears down its own compose stack on exit, including on failure.

### Stopping the service

```sh
docker compose down                   # stops + removes container, keeps ./data
docker compose down -v                # also removes the (empty) volume metadata
```

## HTTP API

All write-paths and the browser UI are auth-gated.

| Method & Path                     | Auth                       | Purpose |
| --------------------------------- | -------------------------- | ------- |
| `GET /health`                     | none                       | Liveness probe (`{ok:true}`) |
| `GET /`                           | none                       | Web upload form (API key injected into HTML) |
| `POST /api/upload`                | `X-API-Key`                | Multipart upload → RFC 3161 timestamped bundle |
| `POST /login`                     | password                   | Form login, sets `session=…; HttpOnly; Secure; SameSite=Lax` |
| `GET /login`                      | none                       | Login page |
| `POST /logout`                    | session                    | Clears session cookie |
| `GET /archive`                    | session                    | Chronological list (filename / date / type / TSA-status) |
| `GET /archive/:id`                | session                    | Detail page with all 9 metadata fields + Verify button |
| `POST /api/archive/:id/verify`    | session                    | Re-hashes original on disk + checks TSR → `{ok:true \| false, reason?}` |
| `GET /api/download/:id`           | `X-API-Key` OR session     | Streams ZIP bundle (8 files incl. `VERIFY.md`) |

Unauthenticated requests to a session-protected page get a 303 to
`/login?next=…`; the same on a JSON endpoint gets a 401 envelope
`{error:true, code:"UNAUTHORIZED"}`. Wrong/missing `X-API-Key` also gets a
401 envelope (timing-safe comparison).

## Deployment

### Docker Compose (any Linux host)

```sh
# 1. Clone and create your .env file.
git clone https://github.com/your-org/veritas.git
cd veritas
mkdir -p data
cat > .env <<EOF
API_KEY=<strong-random-hex-32+-bytes>
SESSION_SECRET=<strong-random-hex-32+-bytes>
ADMIN_PASSWORD=<passphrase>
EOF
chmod 600 .env

# 2. Build and start.
docker compose build
docker compose up -d
docker compose logs --tail=50 veritas     # confirm "listening on …:3700"
```

### Reverse proxy / HTTPS

The container binds port 3700. Put a reverse proxy (nginx, Caddy, Traefik, …)
in front to terminate TLS. Set `COOKIE_SECURE=true` (the default) when
serving over HTTPS. For plain-HTTP LAN access set `COOKIE_SECURE=false` — the
session cookie will otherwise be silently dropped by the browser.

API requests (`X-API-Key`) work over both HTTP and HTTPS because they don't
rely on cookies.

### Smoke test

```sh
export API_KEY=<your-key>

# Upload a test file.
curl -H "X-API-Key: $API_KEY" \
  -F file=@tests/fixtures/hello.txt -F label=smoke \
  http://localhost:3700/api/upload
# Capture the returned id.

# Verify the bundle on disk.
ls -la data/<id>/                               # expect 7 files
cat data/<id>/metadata.json | jq .tsa_provider  # which TSA signed
bash data/<id>/verify.sh                        # expect VERIFICATION SUCCESS

# Bundle-isolation check — nothing should live inside the container.
docker compose exec -T veritas sh -c '[ ! -e /app/data ]' && echo "isolated"
```

### Notes

- Bundle files are written as uid 10001 (the container's non-root `app` user).
  If your host user differs, run `chown -R $(id -u):$(id -g) ./data`.
- Outbound HTTPS to DFN (`zeitstempel.dfn.de`), FreeTSA (`freetsa.org`), and
  DigiCert (`timestamp.digicert.com`) must be reachable from inside the
  container. If DFN is unreachable the fallback chain picks FreeTSA then
  DigiCert — `metadata.tsa_provider` records which one actually signed.
- `restart: unless-stopped` keeps the container running across host reboots.

## What's inside a bundle

**On disk (`./data/<id>/`, 7 files):**

| File              | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `original.<ext>`  | The submitted file, byte-for-byte                         |
| `original.sha256` | `sha256sum -c`-compatible digest line                     |
| `original.tsq`    | RFC 3161 TimeStampQuery sent to the TSA                   |
| `original.tsr`    | RFC 3161 TimeStampResp returned by the TSA                |
| `tsa-cacert.pem`  | CA chain for the TSA that signed `original.tsr`           |
| `metadata.json`   | 12-field snake_case envelope (id, hash, ip, provider, …)  |
| `verify.sh`       | Self-contained verifier (mode 555) — POSIX sh, no network |

**In the download ZIP (`GET /api/download/:id`, 8 files):**
All seven of the above, plus `VERIFY.md` — a German legal framing referencing
§ 286 ZPO (Beweiswürdigung, RFC 3161 als unterstützendes Beweismittel).

All disk files are written with mode `444` after the bundle is finalized
(D-07). Tampering with any file causes `verify.sh` to exit non-zero with a
specific failure string (`SHA256 MISMATCH` or `TIMESTAMP VERIFICATION
FAILED`).

## Configuration

| Env var                  | Default                          | Purpose                                                |
| ------------------------ | -------------------------------- | ------------------------------------------------------ |
| `API_KEY` *(required)*   | —                                | `X-API-Key` value for `/api/upload` and `/api/download` |
| `SESSION_SECRET` *(req.)*| —                                | HMAC secret for session cookies (≥32 bytes)            |
| `ADMIN_PASSWORD` *(req.)*| —                                | Password for the browser `/login` page                 |
| `DATA_DIR`               | `/data` (in container)           | Root for ULID bundle directories                       |
| `MANIFEST_DB_PATH`       | `/data/manifest.sqlite`          | SQLite manifest path                                   |
| `PORT`                   | `3700`                           | HTTP listen port                                       |
| `MAX_UPLOAD_BYTES`       | `104857600` (100 MiB)            | Per-upload size limit                                  |
| `TSA_DFN_ENDPOINT`       | `http://zeitstempel.dfn.de`      | DFN TSA URL                                            |
| `TSA_FREETSA_ENDPOINT`   | `https://freetsa.org/tsr`        | FreeTSA URL                                            |
| `TSA_DIGICERT_ENDPOINT`  | `http://timestamp.digicert.com`  | DigiCert TSA URL                                       |
| `TSA_TIMEOUT_MS`         | `10000`                          | Per-TSA request timeout                                |

The server fails fast on startup if `API_KEY`, `SESSION_SECRET`, or
`ADMIN_PASSWORD` are missing or `SESSION_SECRET` is shorter than 32 bytes.

## Development

```sh
npm install
npm run dev           # tsx watch (requires .env.local)
npm test              # vitest (unit + e2e; real TSA round trips)
npm run build         # tsc → dist/
```

`.env.local` mirrors the compose env block (`API_KEY`, `SESSION_SECRET`,
`ADMIN_PASSWORD`, `DATA_DIR`, `MANIFEST_DB_PATH`).

## Secret Scanning

This repository uses [gitleaks](https://github.com/gitleaks/gitleaks) to prevent secrets and personal identifiers from being committed.

### Activate the pre-commit hook (one-time setup)

```bash
brew install gitleaks          # macOS
git config core.hooksPath .githooks
```

The hook runs `gitleaks protect --staged` before every commit. If gitleaks is not installed it warns and allows the commit — install it to get full protection.

### Custom rules

`.gitleaks.toml` adds project-specific patterns on top of gitleaks defaults:

| Rule | Pattern |
|------|---------|
| `personal-lan-ip` | `192.168.178.x` LAN addresses |
| `personal-domain` | `*.lennart.de` domains |
| `personal-username` | `trytofly94` |

### CI

GitHub Actions runs `gitleaks/gitleaks-action@v2` on every push and pull request as a backstop.

## Project layout

```
src/
  server.ts                Hono app factory (createApp)
  routes/                  upload, pages, login, archive, download
  lib/                     hash, tsa, bundle, metadata, sessionCookie, …
  middleware/              apiKey, requireSession, errorEnvelope
  views/                   server-rendered HTML (upload, login, list, detail)
  db/                      Drizzle schema, client, backfill
  static/                  Alpine.js + upload.js + archive-detail.js + style.css
assets/tsa-certs/          Committed CA chains for DFN, FreeTSA, DigiCert
assets/verify-template.sh  Source for the bundled verify.sh (POSIX, mode 555)
tests/                     Vitest unit + e2e suites (incl. real TSA round trips)
scripts/                   Operator scripts (smoke-container.sh)
.planning/                 GSD workflow artifacts (phases, plans, audits)
Dockerfile                 Multi-stage build → node:22-bookworm-slim runtime
docker-compose.yml         Single-service compose stack (container_name=veritas)
```

> **Disclaimer:** This project was built with AI assistance (Claude by Anthropic). Use at your own risk.
