# auto-archive

Self-hosted, court-grade file archive. Every submitted file is hashed
(SHA-256) and timestamped via RFC 3161 (DFN → FreeTSA → DigiCert fallback)
into a tamper-proof bundle on a bind-mounted volume.

> **⚠ Phase 1 has no authentication. DO NOT publish port 3000 to the public
> internet.** Phase 2 will add API-key middleware in front of the same
> endpoint. Until then, reach the service only over your LAN (or behind an
> authenticated reverse proxy such as Cloudflare Tunnel + Authelia).

## Prerequisites

- Docker 24+ with the Compose v2 plugin (`docker compose ...`)
- `openssl` on the host (used to run `verify.sh` against any produced bundle —
  the container ships its own openssl for the service itself)
- `curl` on the host for ad-hoc submissions (optional)

## Quickstart (local Docker)

```sh
# 1. Build + start the container in the background.
docker compose up -d --build

# 2. Health check.
curl -s http://127.0.0.1:3000/health
# → {"ok":true}

# 3. Submit a file. The bundle directory lands on ./data on the host.
curl -F file=@tests/fixtures/hello.txt -F label=smoke \
  http://127.0.0.1:3000/api/upload
# → 201 {"id":"01J…","bundle_path":"/data/01J…"}

# 4. Inspect the bundle on the host.
ls -la ./data/<id>/
#   original.txt    original.sha256  original.tsq    original.tsr
#   tsa-cacert.pem  metadata.json    verify.sh

# 5. Verify the bundle independently (host openssl + host sha256sum).
bash ./data/<id>/verify.sh
# → VERIFICATION SUCCESS
```

### File ownership

Files written into `./data` on the host are owned by **uid 10001** — the
non-root `app` user inside the container (Threat T-03-01 mitigation). If you
need a different owner (e.g. Unraid's default `nobody:users` = `99:100`):

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

## Deploy to Unraid

The Phase 1 deployment target is the Unraid server at `192.168.178.30`. The
image is identical to the local build — only the bind-mount path changes.

> **Phase 1 must NOT be reachable from the public internet.** Bind port 3000
> to the LAN only and put any external exposure (Cloudflare Tunnel etc.)
> behind authenticated proxy in a later phase.

### One-time procedure

```sh
# 1. On your laptop — push the repo to Unraid's appdata share.
rsync -avz --delete \
  --exclude node_modules --exclude data --exclude .git \
  ./ root@192.168.178.30:/mnt/user/appdata/auto-archive/

# 2. SSH in and start the service.
ssh root@192.168.178.30
cd /mnt/user/appdata/auto-archive
mkdir -p data
docker compose build
docker compose up -d
docker compose logs --tail=50 auto-archive     # confirm "listening on …:3000"
```

### Production smoke test (from your laptop)

```sh
# Submit a file directly to the Unraid host.
curl -F file=@tests/fixtures/hello.txt -F label=unraid-smoke \
  http://192.168.178.30:3000/api/upload
# Capture the returned id.

# SSH back in and verify the bundle on the real Unraid filesystem.
ssh root@192.168.178.30
cd /mnt/user/appdata/auto-archive
ls -la data/<id>/                              # expect 7 files
cat data/<id>/metadata.json | jq .tsa_provider # records which TSA signed
bash data/<id>/verify.sh                       # expect VERIFICATION SUCCESS

# Bundle-isolation check (CONCERN-4) — nothing should live inside the container.
docker compose exec -T auto-archive sh -c '[ ! -e /app/data ]' && echo "isolated"

# Stop + confirm data survives.
docker compose down
ls -la data/<id>/                              # bundle still present
```

### Unraid-specific notes

- Bundle files inherit uid 10001 from the container's `app` user. If you want
  Unraid's share user to own them, run `chown -R 99:100 ./data` after the
  first submission (or after each one — the bundle becomes immutable at
  mode `444` regardless).
- Outbound HTTPS to DFN (`zeitstempel.dfn.de`), FreeTSA (`freetsa.org`), and
  DigiCert (`timestamp.digicert.com`) must work from inside the Docker bridge.
  If DFN is unreachable, the fallback chain transparently picks FreeTSA then
  DigiCert — `metadata.tsa_provider` records which one actually signed.
- The container declares `restart: unless-stopped`, so it survives reboots
  automatically once started.

## What's inside a bundle

| File              | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `original.<ext>`  | The submitted file, byte-for-byte                         |
| `original.sha256` | `sha256sum -c`-compatible digest line                     |
| `original.tsq`    | RFC 3161 TimeStampQuery sent to the TSA                   |
| `original.tsr`    | RFC 3161 TimeStampResp returned by the TSA                |
| `tsa-cacert.pem`  | CA chain for the TSA that signed `original.tsr`           |
| `metadata.json`   | 12-field snake_case envelope (id, hash, ip, provider, …)  |
| `verify.sh`       | Self-contained verifier (mode 555) — POSIX sh, no network |

All other files are written with mode `444` after the bundle is finalized
(D-07). Tampering with any file causes `verify.sh` to exit non-zero with a
specific failure string (`SHA256 MISMATCH` or `TIMESTAMP VERIFICATION FAILED`).

## Configuration

| Env var                | Default                          | Purpose                           |
| ---------------------- | -------------------------------- | --------------------------------- |
| `DATA_DIR`             | `/data` (in container)           | Root for ULID bundle directories  |
| `PORT`                 | `3000`                           | HTTP listen port                  |
| `TSA_DFN_ENDPOINT`     | `http://zeitstempel.dfn.de`      | DFN TSA URL                       |
| `TSA_FREETSA_ENDPOINT` | `https://freetsa.org/tsr`        | FreeTSA URL                       |
| `TSA_DIGICERT_ENDPOINT`| `http://timestamp.digicert.com`  | DigiCert TSA URL                  |
| `TSA_TIMEOUT_MS`       | `10000`                          | Per-TSA request timeout           |

## Development

```sh
npm install
npm run dev           # tsx watch
npm test              # vitest (unit + e2e; real TSA round trips)
npm run build         # tsc → dist/
```

## Project layout

```
src/                  Hono server + lib (hash, tsa, bundle, metadata)
assets/tsa-certs/     Committed CA chains for DFN, FreeTSA, DigiCert
assets/verify-template.sh   Source for the bundled verify.sh
tests/                Vitest unit + e2e suites
scripts/              Operator scripts (smoke-container.sh)
.planning/            GSD workflow artifacts (phases, plans, summaries)
Dockerfile            Multi-stage build → node:22-bookworm-slim runtime
docker-compose.yml    Single-service compose stack (container_name=auto-archive)
```
