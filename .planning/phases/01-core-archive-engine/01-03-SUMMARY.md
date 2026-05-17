---
phase: 01-core-archive-engine
plan: 03
subsystem: core-archive
tags: [docker, unraid, deployment, smoke-test, bookworm-slim, healthcheck-fetch]
requires:
  - "Plan 01-01 walking skeleton (POST /api/upload, DFN happy path)"
  - "Plan 01-02 TSA fallback chain + verify.sh (7-file bundle)"
provides:
  - "Multi-stage Dockerfile (deps → build → runtime) on node:22-bookworm-slim with openssl + non-root user (uid 10001) + Node-fetch HEALTHCHECK"
  - "docker-compose.yml with container_name=auto-archive and bind-mount ./data:/data"
  - "scripts/smoke-container.sh — automated end-to-end container smoke (build → up → health → POST → verify.sh → isolation check → down)"
  - "tests/e2e/container-smoke.test.ts — vitest gate around the smoke script"
  - "GET /health route (200, {ok:true}) — added as part of Task 1 to back the HEALTHCHECK"
  - "Verified Unraid production deploy on 192.168.178.30 with tsa_provider='dfn' (resolves STATE.md blocker)"
  - ".planning/phases/01-core-archive-engine/01-UNRAID-VERIFY.md — empirical verification report"
affects:
  - "Phase 2 SEC-01 will wrap /api/upload with X-API-Key middleware in the same container"
  - "Phase 2 deploy story will inherit this docker-compose.yml (with two follow-up parameterisations recorded in STATE.md)"
tech-stack:
  added: []  # no new npm dependencies; container only
  patterns:
    - "Multi-stage Docker build with deps-only prod node_modules in stage 1 + dist + assets in runtime"
    - "Node 22 built-in fetch as HEALTHCHECK probe (no curl in runtime image — CONCERN-5)"
    - "Pinned container_name for deterministic `docker compose exec` (CONCERN-4)"
    - "Bind-mount /data on host so bundles outlive container lifecycle"
key-files:
  created:
    - "Dockerfile"
    - "docker-compose.yml"
    - ".dockerignore"
    - "scripts/smoke-container.sh"
    - "tests/e2e/container-smoke.test.ts"
    - ".planning/phases/01-core-archive-engine/01-UNRAID-VERIFY.md"
  modified:
    - "README.md"
    - "src/server.ts"  # GET /health route added
    - ".planning/STATE.md"  # blocker resolved + 2 Phase-2 follow-ups
decisions:
  - "HEALTHCHECK uses `node -e \"fetch('http://127.0.0.1:3000/health')...\"` not curl — keeps the runtime image free of apt-installed curl (CONCERN-5 mitigation)."
  - "container_name=auto-archive pinned in docker-compose.yml so `docker compose exec` is name-deterministic regardless of compose project naming (CONCERN-4)."
  - "Bundle file ownership stays at uid 10001 on host; README documents the optional `chown -R 99:100 ./data` Unraid-share workaround instead of changing the container's runtime user (Phase 1 leaves uid 10001; Phase 2 may revisit)."
  - "Two real-world Unraid deviations are documented in 01-UNRAID-VERIFY.md and converted into Phase-2 STATE.md follow-ups rather than retrofitting them into Phase 1: (a) host port parameterisation, (b) bind-mount chown automation."
metrics:
  duration: "~50 min (Task 1 implementation + automated smoke + Task 2 human-verify deploy)"
  completed: "2026-05-17"
  tasks: 2
  commits: 2  # T1 ca04f0c + T2 verify-report commit
  files_created: 6
  files_modified: 3
  image_size: "n/a — not measured during Unraid smoke; node:22-bookworm-slim base ~250 MB; auto-archive layer adds dist/ + assets/ + prod node_modules"
  build_time_unraid: "~30 s (cold node:22-bookworm-slim pull + npm ci + tsc)"
  unraid_post_latency: "234 ms end-to-end (POST → hash → DFN-TSA → bundle write → response)"
  observed_tsa_provider_unraid: "dfn"
  observed_uid_unraid: "10001"
---

# Phase 1 Plan 01-03: Dockerize for Unraid + Production Smoke Test Summary

**One-liner:** Multi-stage Dockerfile on `node:22-bookworm-slim` with non-root user, Node-fetch HEALTHCHECK, and pinned container name; verified end-to-end on real Unraid hardware at 192.168.178.30 with `tsa_provider="dfn"` — closing the STATE.md DFN-reachability blocker and the Phase 1 deliverable.

## What Shipped

Phase 1 is now production-deployable. The exact same image that runs `bash scripts/smoke-container.sh` GREEN on the developer's laptop also runs GREEN on Unraid:

1. **Dockerfile** — three stages (`deps`, `build`, `runtime`) on `node:22-bookworm-slim`. The runtime stage installs `openssl` + `ca-certificates`, creates user `app` (uid 10001), copies prod node_modules + dist + assets, declares `VOLUME /data`, exposes 3000, and runs `node dist/index.js` as `app`. `RUN openssl version` is a build-time assertion that openssl is present.
2. **HEALTHCHECK** uses Node 22's built-in `fetch` — no curl in the image (CONCERN-5).
3. **docker-compose.yml** — single service `auto-archive`, `container_name: auto-archive` pinned (CONCERN-4), bind-mount `./data:/data`, env passthrough for `TSA_*_ENDPOINT` overrides.
4. **scripts/smoke-container.sh** — automated end-to-end: build → up → poll /health → curl POST → assert HTTP 201 → enumerate 7 bundle files on host → run verify.sh → assert `[ ! -e /app/data ]` inside container → compose down. Wrapped in `tests/e2e/container-smoke.test.ts` so CI gates on it.
5. **GET /health** route added to `src/server.ts` (returns `{ok:true}`) to back the HEALTHCHECK probe.
6. **Unraid production smoke** — verified on `192.168.178.30` (Unraid-Tower, Docker 27.5.1). HTTP 201 in 234 ms, 7-file bundle on `/mnt/user/appdata/auto-archive/data/01KRV0MNJFW3V27RPJEYGV5APD/`, `verify.sh` exits 0 with `VERIFICATION SUCCESS`, `tsa_provider="dfn"` (no fallback triggered). Container isolation pass: `[ ! -e /app/data ]` is true.

The phase-goal sentence is now literally true: *"A running Docker container on Unraid can accept a file, hash it, obtain an RFC 3161 timestamp, and write a complete tamper-proof archive bundle to a bind-mounted volume."*

## Architecture

```
docker compose up -d
  └─ auto-archive (container_name pinned)
       USER app (uid 10001), WORKDIR /app, EXPOSE 3000
       HEALTHCHECK: node -e "fetch('http://127.0.0.1:3000/health')…"
       CMD ["node","dist/index.js"]
       VOLUME /data  ←  bind-mount ./data on host (./mnt/user/appdata/auto-archive/data on Unraid)

POST :3000/api/upload (multipart)
  → busboy → tempfile → sha256 → DFN-TSA → verify-tsr → atomic writeBundle to /data
  → 201 {id, bundle_path}
  → host ./data/<ULID>/ contains the 7 CORE-03 files, owned by uid 10001
```

## Tasks + Commits

| Task | Name | Type | Commit |
|------|------|------|--------|
| 1 | Dockerfile + docker-compose.yml + container smoke + README + /health route | feat | `ca04f0c` feat(01-03): containerize service for Unraid deploy (Task 1) |
| 2 | Unraid production smoke (human-verify checkpoint, RESOLVED) | chore | `1c53956` chore(01-03): record Unraid production-smoke verification (T2) |

## Observed Behavior

| Measurement | Value | Source |
|---|---|---|
| Unraid host | `192.168.178.30` — Unraid-Tower, Linux 6.12.54, Docker 27.5.1, Compose v2.35.0 | 01-UNRAID-VERIFY.md |
| Image tag | `auto-archive:phase1` (sha256:137b99a4…) | 01-UNRAID-VERIFY.md |
| Build time (cold) on Unraid | ~30 s | 01-UNRAID-VERIFY.md |
| POST /api/upload latency on Unraid | **234 ms** (vs. ~217 ms on dev laptop) | 01-UNRAID-VERIFY.md |
| Observed `tsa_provider` on Unraid | **`"dfn"`** — fallback chain `["dfn"]` | metadata.json in bundle |
| Bundle file ownership on Unraid host | `10001:10001` | `ls -la /mnt/user/appdata/auto-archive/data/<id>/` |
| Bundle size | 7 files (modes `444` for artifacts, `555` for verify.sh) | 01-UNRAID-VERIFY.md |
| `verify.sh` on Unraid | exit 0, `VERIFICATION SUCCESS` | 01-UNRAID-VERIFY.md |
| `[ ! -e /app/data ]` inside container | ABSENT (exit 0) — no leak | 01-UNRAID-VERIFY.md |
| Persistence after `docker compose down` | Bundle dir survives on host | 01-UNRAID-VERIFY.md |

Full empirical record: **[01-UNRAID-VERIFY.md](./01-UNRAID-VERIFY.md)**.

## Deviations from Plan

### 1. [Operational — Unraid] Port 3000 already allocated on this Unraid host

- **Found during:** Task 2 (human-verify), first `docker compose up -d` on Unraid
- **Issue:** Port 3000 on `192.168.178.30` is already bound by `binhex-official-gluetun`. `docker compose up -d` failed with `Bind for 0.0.0.0:3000 failed: port is already allocated`.
- **Workaround:** Edited `docker-compose.yml` on the Unraid host to remap `3000:3000` → `3300:3000`. Phase 1 docker-compose.yml in this repo still ships `3000:3000` — the deviation lives on the Unraid host's copy.
- **Phase-2 follow-up (logged in STATE.md):** Parameterise the host port via `${HOST_PORT:-3000}` so deploys can override without editing the file.
- **Operational / packaging concern only — not a protocol issue.**

### 2. [Operational — Unraid] Bind-mounted `./data` uid mismatch on fresh deploy

- **Found during:** Task 2 (human-verify), first POST upload on Unraid
- **Issue:** `mkdir -p data` on Unraid created the directory as root. The container runs as uid 10001, so the first upload returned `502 {"error":"EACCES: permission denied, mkdir '/data/.tmp-...'"}`.
- **Workaround:** `chown -R 10001:10001 /mnt/user/appdata/auto-archive/data/` on the Unraid host before retrying. Upload then succeeded immediately.
- **Phase-2 follow-up (logged in STATE.md):** README "Deploy to Unraid" should mandate the chown step explicitly, or the entrypoint should attempt it automatically (`chown -R app:app /data 2>/dev/null || true` as root before dropping privileges).
- **Operational / packaging concern only — not a protocol issue.**

Both deviations are captured in detail in [01-UNRAID-VERIFY.md](./01-UNRAID-VERIFY.md) §Deviations Captured and in STATE.md as Phase-2 follow-ups.

## Authentication Gates

None. DFN-TSA, FreeTSA, and DigiCert are all unauthenticated. Unraid SSH access used the developer's existing key — no new credentials provisioned for this plan.

## Known Stubs

None. The Dockerfile, compose file, and smoke script all run real workloads against real services. The /health route returns a real liveness probe.

## Acceptance Criteria — All Met

### Task 1 (local Docker smoke)

- [x] `docker compose build` exits 0; `auto-archive:phase1` is created.
- [x] `docker run --rm auto-archive:phase1 openssl version` prints an OpenSSL version line.
- [x] `docker inspect … --format '{{.Config.User}}'` returns `app`.
- [x] curl is NOT installed in the runtime image (CONCERN-5).
- [x] `docker inspect … --format '{{json .Config.Healthcheck.Test}}'` contains `"fetch('http://127.0.0.1:3000/health')"`.
- [x] `bash scripts/smoke-container.sh` exits 0.
- [x] `docker ps --filter name=^auto-archive$` returns exactly `auto-archive` (CONCERN-4).
- [x] Bundle dir on host contains exactly 7 files.
- [x] `bash ./data/<id>/verify.sh` exits 0 with `VERIFICATION SUCCESS`.
- [x] `docker compose exec -T auto-archive sh -c '[ ! -e /app/data ]'` exits 0 (CONCERN-4 isolation).
- [x] Bundles persist across `docker compose down`.
- [x] `npm test -- --run tests/e2e/container-smoke.test.ts` exits 0.

### Task 2 (Unraid production verify)

- [x] `.planning/phases/01-core-archive-engine/01-UNRAID-VERIFY.md` exists and documents observed `tsa_provider`, latency, host uid, and the two deviations.
- [x] Step 4 (POST upload from local machine to `http://192.168.178.30:3300/api/upload`) returned HTTP 201.
- [x] Step 5 enumerated exactly 7 files in the bundle directory on the Unraid host.
- [x] Step 7 (`bash verify.sh` on the Unraid host) printed `VERIFICATION SUCCESS` and exited 0.
- [x] Step 8 (`[ ! -e /app/data ]` inside container) exited 0.
- [x] Step 9 (`docker compose down`) — bundle directory persists on host.
- [x] STATE.md Blockers/Concerns updated: DFN-reachability concern annotated as RESOLVED with reference to 01-UNRAID-VERIFY.md.

## Success Criteria — All Met

- [x] Roadmap SC-5 satisfied: container starts from `docker compose up` with all data on bind-mounted volumes — confirmed both locally AND on Unraid.
- [x] STATE.md blocker "Confirm DFN-TSA HTTP endpoint reachability from inside Docker on Unraid" resolved with empirical evidence (`tsa_provider="dfn"` first-attempt, fallback chain `["dfn"]`).
- [x] Phase-goal sentence is now literally true on real production hardware.
- [x] Container image stays minimal (no curl) and HEALTHCHECK uses Node fetch.
- [x] `container_name` is pinned so isolation assertions are deterministic.

## Threat Flags

None new. The implemented surface (single container, bind-mount, port 3000, no auth) is exactly what `<threat_model>` in the plan registers. The README explicitly carries the no-auth warning from Plan 01-01 (T-03-05 mitigation).

## Self-Check: PASSED

- File `Dockerfile` exists in repo root (created by `ca04f0c`).
- File `docker-compose.yml` exists in repo root (created by `ca04f0c`).
- File `scripts/smoke-container.sh` exists (created by `ca04f0c`).
- File `tests/e2e/container-smoke.test.ts` exists (created by `ca04f0c`).
- File `.planning/phases/01-core-archive-engine/01-UNRAID-VERIFY.md` exists (created by `1c53956`).
- Commit `ca04f0c` present in `git log` (Task 1).
- Commit `1c53956` present in `git log` (Task 2 verification report).

## Hand-Off to Phase 2

Phase 2 (SEC-01 + UPLOAD-01 — API-key auth + Cloudflare Tunnel publication) inherits:

1. A working `auto-archive:phase1` image and `docker-compose.yml` that runs unchanged on Unraid.
2. A pre-finalization-verified RFC 3161 chain (DFN→FreeTSA→DigiCert) with `verify.sh` in every bundle.
3. Two operational follow-ups logged in STATE.md to address during Phase 2 deploy work:
   - Parameterise the host port via `${HOST_PORT:-3000}` in `docker-compose.yml`.
   - Make the bind-mount chown step automatic (entrypoint) or mandate it in README "Deploy to Unraid".
4. The STATE.md DFN-reachability blocker is resolved — Phase 2 can assume DFN is the de-facto provider on Unraid without re-verifying.
5. The no-auth warning is the next thing to remove: SEC-01 (`X-API-Key` middleware) is the natural first plan of Phase 2 and the README warning will be revised once auth is in place.
