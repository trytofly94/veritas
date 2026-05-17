---
phase: 01-core-archive-engine
plan: 03
type: verification
status: passed
verified_at: 2026-05-17T13:05Z
verified_by: orchestrator (claude-opus-4-7, executed via SSH from developer mac)
host: 192.168.178.30 (Unraid-Tower, Linux 6.12.54, Docker 27.5.1)
---

# 01-03 Unraid Production Smoke — Verification Report

## Summary

✅ **PASSED.** Phase 1 deliverable confirmed on real Unraid hardware. DFN-TSA is reachable from the Unraid Docker bridge — the STATE.md blocker is **resolved**.

## Environment

- **Host:** `192.168.178.30` — Unraid-Tower
- **Kernel:** `Linux 6.12.54-Unraid SMP PREEMPT_DYNAMIC x86_64`
- **CPU:** Intel Core i5-9400 @ 2.90 GHz
- **Docker:** `27.5.1, build 9f9e405`
- **Compose:** `v2.35.0`
- **Image:** `auto-archive:phase1` (sha256:137b99a4...)
- **Container:** `auto-archive` (pinned name, CONCERN-4)

## Deploy Procedure (as executed)

1. `rsync -az --delete --exclude node_modules --exclude data --exclude .git --exclude scratchpads --exclude .planning ./ root@192.168.178.30:/mnt/user/appdata/auto-archive/`
2. `ssh root@192.168.178.30 'cd /mnt/user/appdata/auto-archive && mkdir -p data && docker compose build && docker compose up -d'`
3. **Deviation:** Initial start failed with `Bind for 0.0.0.0:3000 failed: port is already allocated` — port 3000 on this Unraid host is occupied by `binhex-official-gluetun`. Remapped the host port to `3300` by editing `docker-compose.yml` line `3000:3000` → `3300:3000`. **Action item for Phase 2:** parameterise the host port in `docker-compose.yml` via `${HOST_PORT:-3000}` so it can be overridden without editing the file.
4. **Deviation:** First upload returned `502 {"error":"EACCES: permission denied, mkdir '/data/.tmp-...'"}`. The bind-mounted `./data` dir was created by `mkdir -p data` as root, but the container runs as uid 10001. Fixed with `chown -R 10001:10001 /mnt/user/appdata/auto-archive/data/`. **Action item for Phase 2:** README "Deploy to Unraid" should mention the chown step explicitly, or the smoke script / entrypoint should attempt the chown at start.

## Test Results

| Step | Command | Result |
| ---- | ------- | ------ |
| 1 | `docker compose build` | OK |
| 2 | `docker compose up -d` | OK after port remap |
| 3 | `curl /health` | `{"ok":true}` |
| 4 | `curl -F file=@hello.txt -F label=unraid-smoke /api/upload` | **HTTP 201 in 234 ms**, `{"id":"01KRV0MNJFW3V27RPJEYGV5APD","bundle_path":"/data/01KRV0MNJFW3V27RPJEYGV5APD"}` |
| 5 | `ls -la data/<id>/` | **7 files**, all owned by `10001:10001`, modes `r--r--r--` (verify.sh: `r-xr-xr-x`) |
| 6 | `metadata.json` `.tsa_provider` | **`"dfn"`** — DFN responded on first attempt; fallback chain `["dfn"]` |
| 7 | `bash verify.sh` | **`VERIFICATION SUCCESS: original.txt hashes match and timestamp is valid`**, exit 0 |
| 8 | `docker exec auto-archive sh -c '[ ! -e /app/data ]'` | **ABSENT** — no leak into container filesystem (CONCERN-4) |
| 9 | `docker compose down` | OK |
| 10 | `ls data/` after down | Bundle directory persists on host (`01KRV0MNJFW3V27RPJEYGV5APD/`) |

## Latency

- **TSA round-trip from Unraid → DFN:** ≤ 234 ms (end-to-end POST including hash + bundle write; previous local measurement on developer laptop was ~217 ms)
- **Build time:** ~30 s (cold node:22-bookworm-slim pull + npm ci + tsc)

## tsa_provider Observation

`"dfn"` — DFN-TSA is reachable through the Unraid Docker bridge on first attempt. The bundle's `tsa_fallback_chain` is `["dfn"]`, meaning fallback did NOT trigger. This **resolves** the STATE.md blocker `"Confirm DFN-TSA HTTP endpoint reachability from inside Docker on Unraid before committing as primary"`.

## Host File Ownership

Bundle files on host are owned by `10001:10001`. Unraid default share uid is `99:100` (`nobody:users`). Lennart's user owns the parent dir (`lennart:games`). README documents the optional `chown -R 99:100 ./data` workaround for Unraid users who need share-uid ownership.

## Deviations Captured

1. **Port 3000 conflict on this Unraid host** — already used by gluetun. Worked around by remapping to `3300`. **Recommend:** parameterise via env in `docker-compose.yml` for Phase 2.
2. **Bind-mount uid mismatch on fresh deploy** — empty `./data` created as root, container needs uid 10001 write access. Worked around with explicit `chown` after first failure. **Recommend:** add the chown to README's Deploy-to-Unraid section as a mandatory step, or have the entrypoint attempt it.

Both deviations are operational / packaging concerns, not protocol concerns. The archival chain (hash → DFN-TSA → atomic bundle → verify.sh) works correctly on real Unraid hardware.

## Verdict

**Phase 1 deliverable proven on production hardware.** All success criteria observable:
- ✅ POST upload returns 201 with bundle ID
- ✅ Bundle has exactly 7 CORE-03 files
- ✅ `verify.sh` exits 0 with "VERIFICATION SUCCESS"
- ✅ DFN-TSA is the actual provider (not fallback)
- ✅ Container has no `/app/data` leak
- ✅ Bundle persists across `compose down`

Ready to mark plan 01-03 and phase 01 complete.
