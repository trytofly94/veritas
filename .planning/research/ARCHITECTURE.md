# Architecture Patterns

**Domain:** Self-hosted tamper-proof file archiving with RFC 3161 timestamps
**Researched:** 2026-05-16
**Confidence:** HIGH (canonical RFC protocol, well-established patterns)

---

## Component Overview

The system has five distinct concerns that map to five components. They are all deployed as a single Docker Compose stack on Unraid.

```
                          ┌─────────────────────────────┐
  iOS Shortcut ──────────▶│                             │
  n8n Webhook  ──────────▶│   Upload API (FastAPI)      │──▶ TSA Client
  Web Frontend ──────────▶│   /upload  /verify  /api    │        │
  curl         ──────────▶│                             │        ▼
                          └─────────────────────────────┘   FreeTSA / DFN
                                        │                    (external HTTP)
                                        ▼
                          ┌─────────────────────────────┐
                          │   Archive Storage            │
                          │   /archive/<entry-id>/       │
                          │   (local filesystem, Unraid) │
                          └─────────────────────────────┘
                                        │
                                        ▼
                          ┌─────────────────────────────┐
                          │   Archive Browser            │
                          │   (FastAPI + Jinja2 + HTMX) │
                          │   /browse  /entry/<id>       │
                          └─────────────────────────────┘
                                        │
                                        ▼
                          ┌─────────────────────────────┐
                          │   Cloudflare Tunnel          │
                          │   (cloudflared sidecar)      │
                          │   → archive.lennart.de       │
                          └─────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| Upload API | Receive files, compute SHA-256, orchestrate TSA requests, persist archive entries | TSA Client (internal call), Archive Storage (filesystem write) |
| TSA Client | Build `.tsq`, POST to FreeTSA/DFN, save `.tsr`, retry on failure | FreeTSA `https://freetsa.org/tsr`, DFN `https://zeitstempel.dfn.de` |
| Archive Storage | Filesystem — `/mnt/user/appdata/veritas/archive/` | Read/write by Upload API and Archive Browser |
| Archive Browser | Render entry list, single entry view, verify integrity on-demand | Archive Storage (filesystem read), openssl CLI (subprocess for verify) |
| Cloudflare Tunnel | Expose the single FastAPI process to the public internet | Routes `archive.lennart.de` → `veritas:8000` inside Docker network |

**Key decision: Single FastAPI process, not microservices.** At this scale (one user + family) the operational overhead of multiple services outweighs any benefit. The Upload API and Archive Browser are two route groups (`/api/` and `/browse/`) in the same process. The TSA client is a Python module within that process, not a separate service.

---

## Directory Structure

### Per-Entry Archive Bundle

Each submitted file gets a UUID-based directory. All artifacts for that submission are co-located — this makes the bundle self-contained and independently verifiable with only openssl and the FreeTSA CA certificate.

```
/mnt/user/appdata/veritas/
├── archive/
│   ├── 2026-05-16_143022_a3f8b2c1/        ← {date}_{time}_{uuid8}
│   │   ├── original.{ext}                  ← original file, unchanged
│   │   ├── original.sha256                 ← hex digest, one line
│   │   ├── original.tsq                    ← DER-encoded timestamp request
│   │   ├── original.tsr                    ← DER-encoded timestamp response
│   │   ├── metadata.json                   ← submission context (see below)
│   │   └── verify.sh                       ← standalone verification script
│   ├── 2026-05-15_091145_d9e1f3a7/
│   │   └── ...
│   └── index.json                          ← append-only index of all entries
├── certs/
│   ├── freetsa-ca.pem                      ← FreeTSA CA cert (bundled at build)
│   └── dfn-tsa.crt                         ← DFN TSA cert (bundled at build)
└── db/
    └── archive.db                          ← SQLite — mirrors index.json for fast queries
```

**Why {date}_{time}_{uuid8}?** Human-readable sort order (ls, Finder, rsync diff) without collision risk. The full UUID is in metadata.json.

**Why `original.{ext}` instead of the uploaded filename?** Predictable internal name allows the same code path regardless of upload filename. Original filename is preserved in `metadata.json`.

**Why SQLite alongside index.json?** The browser needs fast search/filter without scanning thousands of directories. SQLite is the right answer. `index.json` is the ground truth — SQLite is rebuilt from it if corrupted.

### metadata.json Schema

```json
{
  "id": "a3f8b2c1-...",
  "entry_dir": "2026-05-16_143022_a3f8b2c1",
  "submitted_at": "2026-05-16T14:30:22Z",
  "submitted_by": "ios-shortcut",
  "submitter_ip": "10.0.0.5",
  "original_filename": "chat_export_2026-05.zip",
  "mime_type": "application/zip",
  "file_size_bytes": 1482903,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "tsa_status": "ok",
  "tsa_provider": "freetsa",
  "tsa_serial": "1234567890",
  "tsa_timestamp": "2026-05-16T14:30:24Z",
  "note": "WhatsApp export with Erika, May 2026",
  "tags": ["whatsapp", "evidence"]
}
```

### verify.sh (bundled in each entry)

This script is generated at archive time and is fully standalone — no dependency on the server application:

```bash
#!/bin/bash
# Verify integrity of this archive entry
# Requires: openssl
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
FILE="$DIR/original.*"  # resolved at generation time to actual extension
TSR="$DIR/original.tsr"
TSQ="$DIR/original.tsq"
CACERT="$DIR/../../certs/freetsa-ca.pem"

echo "=== SHA-256 check ==="
sha256sum -c "$DIR/original.sha256"

echo "=== TSA verification ==="
openssl ts -verify -in "$TSR" -queryfile "$TSQ" -CAfile "$CACERT"

echo "=== PASSED ==="
```

---

## Docker Setup

**Single container, not multi-container.** The application (FastAPI) and the tunnel (cloudflared) are two services in the same Compose stack, sharing one Docker network. There is no separate database container — SQLite lives on the Unraid filesystem.

```yaml
# /mnt/user/appdata/veritas/docker-compose.yml

services:
  veritas:
    image: veritas:latest
    container_name: veritas
    restart: unless-stopped
    environment:
      - API_KEY=${API_KEY}
      - BROWSER_PASSWORD=${BROWSER_PASSWORD}
      - ARCHIVE_DIR=/data/archive
      - DB_PATH=/data/db/archive.db
      - TSA_PRIMARY=https://freetsa.org/tsr
      - TSA_FALLBACK=https://zeitstempel.dfn.de
      - TZ=Europe/Berlin
    volumes:
      - /mnt/user/appdata/veritas/archive:/data/archive
      - /mnt/user/appdata/veritas/db:/data/db
      - /mnt/user/appdata/veritas/certs:/data/certs:ro
    networks:
      - archive-net
    # No exposed ports — access is via cloudflared only (internal) or Caddy-Central

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: veritas-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CF_TUNNEL_TOKEN}
    environment:
      - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
    depends_on:
      - veritas
    networks:
      - archive-net

networks:
  archive-net:
    driver: bridge
```

**Volume mount conventions for Unraid:**
- All persistent data under `/mnt/user/appdata/veritas/` — this is the Unraid standard for appdata
- Archive files on `/mnt/user/` (array) — protected by Unraid parity, not on cache-only
- Do NOT use named Docker volumes (e.g. `volumes: archive-data:`) — Unraid's Community Apps expects bind mounts at `/mnt/user/appdata/` for backup and visibility

**Cloudflare Tunnel routing:** Configured in the Cloudflare Zero Trust dashboard, not in YAML. Route `archive.lennart.de` → `http://veritas:8000`. The service name `veritas` is Docker's internal DNS — no IP address needed.

**Why no port exposure on the host?** The `veritas` container intentionally has no `ports:` mapping. Access from LAN can go through Caddy-Central (`192.168.178.30:PORT` → container) or via the tunnel. This prevents accidental public exposure if the tunnel breaks.

---

## API Design

### Authentication

Two separate auth mechanisms:
- **Upload API** (`/api/*`): API key in header `X-API-Key: <key>`. Simple, works from iOS Shortcuts, curl, n8n.
- **Browser frontend** (`/browse/*`): HTTP Basic Auth or cookie session. Handled by FastAPI middleware, not Authelia (to keep the container self-contained).

For n8n specifically: n8n HTTP Request node sends `X-API-Key` header. No OAuth complexity needed.

### Upload Endpoint

```
POST /api/upload
Content-Type: multipart/form-data
X-API-Key: <key>

Fields:
  file        (required)  binary — the file to archive
  note        (optional)  string — free-text description
  tags        (optional)  string — comma-separated tags
  submitted_by (optional) string — source identifier (ios-shortcut, n8n, web)
```

**Response (202 Accepted — not 200):** Return immediately, TSA request runs in background task.

```json
{
  "id": "a3f8b2c1-...",
  "entry_dir": "2026-05-16_143022_a3f8b2c1",
  "sha256": "e3b0c44...",
  "tsa_status": "pending",
  "status_url": "/api/entries/a3f8b2c1-.../status"
}
```

**Why 202?** TSA requests to FreeTSA can take 2-10 seconds. iOS Shortcuts has a 30s timeout for shortcuts but HTTP requests should complete fast. A background task with status polling is the right pattern. Alternatively a 200 with synchronous TSA request is simpler for v1 — choose based on observed FreeTSA latency.

**Verify endpoint:**

```
POST /api/verify
Content-Type: multipart/form-data
X-API-Key: <key>

Fields:
  file        (required)  binary — file to verify
  entry_id    (required)  string — archive entry ID to verify against
```

**Download bundle endpoint:**

```
GET /api/entries/<entry_id>/bundle
X-API-Key: <key>

Returns: application/zip
  original.{ext}
  original.sha256
  original.tsr
  original.tsq
  metadata.json
  verify.sh
```

### n8n Integration Pattern

n8n workflow:
1. **Trigger node** — whatever event (file arrives somewhere, schedule, webhook)
2. **Read/Binary node** — load the file into binary data
3. **HTTP Request node** — POST to `https://archive.lennart.de/api/upload`
   - Method: POST
   - Authentication: Header Auth → `X-API-Key`
   - Body Content Type: Form Data (multipart)
   - Parameters: `file` (binary), `note` (expression), `submitted_by` (literal: `n8n`)
4. **IF node** — check `tsa_status` != `error`, notify on failure

The n8n HTTP Request node natively supports multipart/form-data with binary data — this is the standard pattern in the n8n community. The binary property from a previous node is mapped to the `file` field.

---

## Archive Browser Architecture

**Use FastAPI + Jinja2 + HTMX. Do not build a React/Vue SPA.**

Rationale: This is a private admin tool for one user. No build step, no node_modules, no API-then-render complexity. HTMX delivers SPA-quality interactions (pagination, search-as-you-type, inline preview) with server-rendered HTML fragments. The same FastAPI process serves both the API and the browser — zero additional infrastructure.

### Browser Routes

```
GET  /browse/                    ← entry list, paginated, with search/filter
GET  /browse/entries/<id>        ← single entry detail, shows metadata + TSA info
GET  /browse/entries/<id>/verify ← run integrity check, return status fragment (HTMX)
GET  /browse/entries/<id>/download ← redirect to /api/entries/<id>/bundle
```

### Pagination for Large Archives

Server-side cursor pagination — not offset. Directory listing scales poorly with offset pagination (skip 5000 dirs = scan 5000 dirs). SQLite with a cursor (last seen `submitted_at`) is O(log n).

HTMX infinite scroll: the list page renders 50 entries, the last row has `hx-get="/browse/?cursor=<timestamp>"` `hx-trigger="revealed"` `hx-swap="afterend"`. No JavaScript needed.

### Search and Filter

SQLite FTS5 (full-text search) on `original_filename`, `note`, `tags`. Filter by date range, submitter, TSA status. HTMX `hx-get` on input with `hx-trigger="keyup changed delay:300ms"` for search-as-you-type.

---

## Build Order

Build in this order — each layer depends on the one before it.

### Phase 1: Core Archive Engine (no UI, no web)

Build the Python module that does the actual work:
1. `sha256_hash(file_path)` → hex string
2. `build_tsq(sha256)` → `.tsq` bytes (openssl subprocess or `rfc3161ng` library)
3. `request_tsr(tsq_bytes, url)` → `.tsr` bytes (httpx POST)
4. `write_entry(file, metadata)` → creates directory, writes all artifacts
5. `verify_entry(entry_dir)` → True/False (openssl subprocess)

Test this in isolation with real FreeTSA requests before touching HTTP.

**Library choice:** Use `rfc3161ng` (PyPI) for TSQ generation — it wraps openssl correctly without subprocess. For verification, use openssl subprocess — it's the canonical verifier and the verify.sh script uses it anyway, so this keeps behavior consistent.

### Phase 2: Upload API (HTTP interface to the engine)

FastAPI app with:
- `POST /api/upload` with API key auth
- `GET /api/entries/<id>/status`
- `GET /api/entries/<id>/bundle`
- `POST /api/verify`
- SQLite index management (insert on upload, query for browser)

Test with curl and with a simulated n8n HTTP Request (Postman/httpie).

### Phase 3: Archive Browser (read-only UI)

FastAPI route group `/browse/` with Jinja2 templates:
- Entry list with HTMX pagination
- Entry detail page
- Inline verification (HTMX swap)

No auth on the API side needed here — the browser is protected by the same process-level auth.

### Phase 4: Docker + Deployment

- Write `Dockerfile` (Python 3.12-slim, copy app, install deps, openssl available)
- Write `docker-compose.yml` with cloudflared sidecar
- Write `.env.example`
- Test on Unraid: volume mounts, Cloudflare Tunnel routing, Caddy-Central passthrough

### Phase 5: iOS Shortcut + n8n Workflow

These are clients, not server code. Build them after the API is running on Unraid:
- iOS Shortcut: Share Sheet → multipart POST with `X-API-Key` header
- n8n workflow: HTTP Request node as described above

---

## Backup Strategy

This is legal evidence — the archive must survive hardware failure.

**3-2-1-1 strategy:**

| Copy | Location | Method | Frequency |
|------|----------|--------|-----------|
| Primary | Unraid array (`/mnt/user/appdata/veritas/`) | Live | Continuous |
| Local backup | Unraid parity + separate disk | Unraid parity | Continuous |
| Offsite | Backblaze B2 or rclone to cloud | rclone cron job | Daily |
| Cold | USB drive / external HDD | Manual rsync | Monthly |

**Unraid-specific:** appdata on the array (not cache-only) means it is protected by parity. Unraid's built-in Appdata Backup plugin or a cron container can rsync to B2.

**Why the archive is append-only by design:** Never delete or overwrite entries — only add. This ensures that any backup copy is never stale in a way that matters. Even a week-old backup retains full integrity of all entries made before that backup.

**Optional WORM hardening:** After writing an entry directory, `chattr +i` on each file makes them immutable at the filesystem level even if the application is compromised. This requires the container to run with `CAP_LINUX_IMMUTABLE` or a privileged host-side cron job.

---

## Scalability Considerations

This system is sized for one household (dozens to low hundreds of entries per year). No scalability work needed for v1. If it ever needed to scale:

| Concern | At current scale | At 100K entries |
|---------|-----------------|-----------------|
| Directory listing | Direct filesystem scan | SQLite cursor pagination (already in design) |
| TSA latency | Synchronous is fine | Background task queue (Celery/ARQ) |
| Storage | Single Unraid array | S3 or NFS — change volume mount only |
| Search | SQLite FTS5 | Meilisearch sidecar |

---

## Sources

- RFC 3161 protocol: https://www.rfc-editor.org/rfc/rfc3161.html
- FreeTSA curl workflow: https://unmitigatedrisk.com/?p=395
- FreeTSA + openssl walkthrough: https://weisser-zwerg.dev/posts/trusted_timestamping/
- rfc3161ng Python library: https://pypi.org/project/rfc3161ng/
- FastAPI file uploads: https://fastapi.tiangolo.com/tutorial/request-files/
- FastAPI + HTMX pattern: https://testdriven.io/blog/fastapi-htmx/
- Cloudflare Tunnel Docker Compose: https://selfhosting.sh/apps/cloudflare-tunnel/
- Docker Compose on Unraid volumes: https://forums.unraid.net/topic/141824-best-practices-on-persisting-docker-volumes-with-docker-compose-in-unraid/
- n8n multipart file upload: https://prosperasoft.com/blog/automation-tools/n8n/n8n-file-upload-binary/
- 3-2-1 backup for legal data: https://www.acronis.com/en/blog/posts/backup-rule/
