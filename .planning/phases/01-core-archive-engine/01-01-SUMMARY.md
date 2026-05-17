---
phase: 01-core-archive-engine
plan: 01
subsystem: core-archive
tags: [hono, typescript, rfc3161, dfn-tsa, sha256, pkijs, busboy, walking-skeleton]
requires: []
provides:
  - "POST /api/upload (multipart, streaming) → DFN-timestamped bundle on disk"
  - "Hono app factory createApp() for tests + entrypoint"
  - "src/lib/hash.ts streaming SHA-256"
  - "src/lib/tsa.ts requestTimestamp() + parseGenTime() (pkijs, no CLI text-regex)"
  - "src/lib/bundle.ts atomic writeBundle() with chmod 444 finalize"
  - "src/lib/metadata.ts D-12 12-field snake_case metadata builder"
  - "assets/tsa-certs/dfn.pem (live-discovered + verified DFN chain)"
affects:
  - "Plan 01-02 will add freetsa/digicert fallback to requestTimestamp()"
  - "Plan 01-02 will add verify.sh to writeBundle()"
  - "Plan 01-03 will containerize this skeleton"
tech-stack:
  added:
    - "hono@^4.6 + @hono/node-server@^1.13 (HTTP framework)"
    - "busboy@^1.6 (streaming multipart parser — added during execution, not in plan)"
    - "pkijs@^3.2 + asn1js@^3.0 (RFC 3161 TSR parsing)"
    - "ulid@^2.3 (bundle directory naming, D-08)"
    - "mime-types@^2.1 (metadata mime_type)"
    - "zod@^3.23 (label validation)"
    - "vitest@^2.1 + tsx@^4.19 + typescript@^5.6 (dev)"
  patterns:
    - "Streaming multipart → temp file → hash → TSA → atomic bundle write"
    - "ASN.1 parsing via pkijs (never regex CLI text output)"
    - "ULID-named tmp dir → rename to final → chmod 444 (atomic finalize)"
key-files:
  created:
    - "package.json"
    - "package-lock.json"
    - "tsconfig.json"
    - ".gitignore"
    - ".dockerignore"
    - "src/index.ts"
    - "src/server.ts"
    - "src/routes/upload.ts"
    - "src/lib/hash.ts"
    - "src/lib/tsa.ts"
    - "src/lib/bundle.ts"
    - "src/lib/metadata.ts"
    - "src/lib/ids.ts"
    - "src/lib/sourceIp.ts"
    - "src/types.ts"
    - "assets/tsa-certs/dfn.pem"
    - "assets/tsa-certs/README.md"
    - "tests/e2e/upload.happy-path.test.ts"
    - "tests/fixtures/hello.txt"
  modified: []
decisions:
  - "Added busboy as a runtime dep (not in CLAUDE.md Libraries table) — Rule 3 (blocking issue): Hono's c.req.parseBody() buffers the entire body into memory, violating CONCERN-3. busboy is the standard streaming alternative and is used by every Node multipart handler that needs bounded memory."
  - "DFN cert chain extracted from a real TSR via pkijs (not from DFN-PKI website) — guarantees the committed chain matches what the live service actually signs with. openssl ts -verify of a live TSR against the committed chain returned 'Verification: OK' before the chain was committed."
  - "Committed assets/tsa-certs/dfn.pem with 3 certs (root + 2 intermediates). The signing cert (Zeitstempel 2023) is embedded in every TSR and is intentionally NOT in the CA file."
metrics:
  duration: "~10 minutes"
  completed: "2026-05-17"
  tasks: 2
  commits: 2
  files_created: 19
  test_run_duration: "361 ms (2 E2E tests, including 50 MiB streaming upload)"
  dfn_round_trip_observed: "~217 ms"
  peak_heap_50mib_upload: "well under 150 MiB delta (test assertion passed)"
---

# Phase 1 Plan 01-01: Walking Skeleton Summary

**One-liner:** End-to-end vertical slice — POST /api/upload streams a file to disk, computes SHA-256, requests an RFC 3161 timestamp from DFN-TSA, and atomically writes a verifiable bundle directory. Real DFN-signed bundles now work locally.

## What Shipped

A runnable `npm run dev` server with `POST /api/upload` accepting `multipart/form-data` (file + optional `label`). On a successful upload the response is `201 {id, bundle_path}` and the bundle directory on disk contains exactly:

- `original.<ext>` (the uploaded file)
- `original.sha256` (sha256sum -c compatible: `<64 hex>  original.<ext>\n` with two spaces)
- `original.tsq` (the RFC 3161 TimeStampQuery)
- `original.tsr` (the DFN-signed TimeStampResp)
- `tsa-cacert.pem` (the DFN CA chain — root + 2 intermediates)
- `metadata.json` (12 snake_case fields per D-12)

All six files end up with mode `0444` after atomic finalize (D-07). On any TSA / pipeline failure, no partial bundle survives (D-05).

## Architecture

```
POST /api/upload
  → busboy streams file part → os.tmpdir()/auto-archive-upload-*
  → sha256OfFile(tempPath)              [streaming, constant memory]
  → requestTimestamp(sha256Hex, 'dfn'): [openssl ts -query + fetch DFN + pkijs parse genTime]
  → buildMetadata({...})                [D-12: 12 snake_case fields]
  → writeBundle({...}):                  [DATA_DIR/.tmp-<ulid>/ → rename → chmod 444]
  → 201 {id, bundle_path}
```

Key technical choices:

| Concern | Resolution |
|---------|------------|
| CONCERN-1 (TSR genTime parsing) | `parseGenTime(tsr)` in `src/lib/tsa.ts` uses asn1js + pkijs to decode `SignedData.encapContentInfo.eContent → TSTInfo → genTime` and calls `.toDate().toISOString()`. The human-readable `openssl ts` text output is never regexed. |
| CONCERN-2 (nonce) | `openssl ts -query -digest ... -sha256 -cert` — the nonce-disabling flag is never passed. Verified by `grep` returning empty on `src/lib/tsa.ts`. |
| CONCERN-3 (peak memory) | Multipart body is streamed via busboy into a per-request temp file (never held in memory). SHA-256 is computed by streaming the temp file back through `crypto.createHash`. The 50 MiB E2E assertion passes the heap-delta < 150 MiB bound. |
| BLOCKER-1 (real cert chain) | Built and committed under the "live-discovery" procedure: real `ts -query` → real `curl` to DFN → extracted embedded certs via pkijs → assembled root + 2 intermediates → proved `openssl ts -verify = Verification: OK` BEFORE committing. Fingerprints recorded in `assets/tsa-certs/README.md`. |
| BLOCKER-2 (metadata schema) | `buildMetadata()` produces exactly the 12 D-12 keys. The E2E test asserts `Object.keys(meta).sort()` matches the expected list. |
| BLOCKER-3 (sha256sum format) | `original.sha256` is written as `${hex}  original<ext>\n` (two spaces). The E2E test regexes the file and also runs `sha256sum -c original.sha256` from inside the bundle dir. |
| T-01-07 (shell injection) | The only attacker-controlled value reaching `execFile('openssl', ...)` is the SHA-256 hex digest, validated against `/^[0-9a-f]{64}$/` before being passed as the `-digest` argument. |

## DFN-PKI CA Chain Composition

Extracted via pkijs from a live TSR (`https://zeitstempel.dfn.de`, 2026-05-17). The chain in `assets/tsa-certs/dfn.pem` is in PEM order **root → CA 2 → Global Issuing CA**:

| # | Subject | SHA-256 fingerprint |
|---|---------|---------------------|
| 0 | `CN=T-TeleSec GlobalRoot Class 2, OU=T-Systems Trust Center, O=T-Systems Enterprise Services GmbH, C=DE` (self-signed root) | `91:E2:F5:78:8D:58:10:EB:A7:BA:58:73:7D:E1:54:8A:8E:CA:CD:01:45:98:BC:0B:14:3E:04:1B:17:05:25:52` |
| 1 | `CN=DFN-Verein Certification Authority 2, OU=DFN-PKI, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., C=DE` | `F6:60:B0:C2:56:48:1C:B2:BF:C6:76:61:C1:EA:8F:EE:E3:95:B7:14:1B:CA:C3:6C:36:E0:4D:08:CD:9E:15:82` |
| 2 | `CN=DFN-Verein Global Issuing CA, OU=DFN-PKI, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., C=DE` | `12:57:AA:C2:F4:EE:AC:6C:A4:94:2C:2C:83:F0:B6:7B:41:A3:B4:71:20:C4:D5:34:29:92:95:13:AC:AD:46:8C` |
| — (signing cert, embedded in every TSR) | `CN=PN: Zeitstempel 2023, pseudonym=Zeitstempel 2023, OU=Geschaeftsstelle, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., L=Berlin, ST=Berlin, C=DE` | `B6:08:8D:BD:DD:08:98:D3:49:07:8D:7C:23:32:A7:4E:CC:84:14:0C:A0:83:59:F0:23:57:25:46:CF:6E:82:E4` |

Verification proof (recorded in `assets/tsa-certs/README.md`):

```
$ openssl ts -verify -in reply.tsr -queryfile query.tsq -CAfile assets/tsa-certs/dfn.pem
Verification: OK
```

## Observed Behavior

- **DFN round-trip latency:** ~217 ms (single sample, `curl` from macOS to `https://zeitstempel.dfn.de`).
- **Peak heap on 50 MiB upload:** < 150 MiB delta from pre-call baseline (assertion in `tests/e2e/upload.happy-path.test.ts:153`). The test client itself loads the 50 MiB fixture into a Blob for `FormData`, so the dominant heap consumer is the client side, not the server.
- **E2E suite runtime:** 361 ms (2 tests including the real DFN round-trip and the 50 MiB upload).

## Tasks + Commits

| Task | Name | Type | Commit |
|------|------|------|--------|
| 1 | Failing E2E test + scaffolding | test | `34a32ec` test(01-01): add failing E2E test + scaffolding for happy-path upload |
| 2 | Implement walking-skeleton slice | feat | `90b9c26` feat(01-01): implement walking-skeleton upload → DFN-TSA → bundle |

## Deviations from Plan

### 1. [Rule 3 - Blocking] Added `busboy` as a runtime dependency

- **Found during:** Task 2 (implementation of `src/routes/upload.ts`)
- **Issue:** The plan calls for streaming the multipart body to disk (CONCERN-3), but the CLAUDE.md Libraries table does not list a streaming multipart parser. Hono's built-in `c.req.parseBody()` buffers the entire body up to the configured bodyLimit (default 100 MiB) into memory — directly violating CONCERN-3 and acceptance criterion "peak heap < 150 MiB for a 50 MiB upload".
- **Fix:** Added `busboy@^1.6.0` + `@types/busboy` as runtime dependencies. busboy reads the raw `IncomingMessage` (exposed by `@hono/node-server` on `c.env.incoming`) and emits file parts as Node streams, which we `pipeline()` directly into a per-request temp file.
- **Files modified:** `package.json`, `package-lock.json`, `src/routes/upload.ts`
- **Commit:** `90b9c26`

### 2. [Rule 1 - Bug] `ArrayBuffer` / `SharedArrayBuffer` narrowing in `tsa.ts`

- **Found during:** `tsc --noEmit` after Task 2 implementation
- **Issue:** `Buffer.prototype.buffer.slice(...)` returns `ArrayBuffer | SharedArrayBuffer` per Node 22 type defs, which isn't assignable to `asn1js.fromBER`'s `BufferSource` parameter.
- **Fix:** Copy the TSR / TSTInfo bytes into a fresh `Uint8Array(buf).buffer` to narrow the type to `ArrayBuffer`. This is also one fewer footgun if a buffer ever happens to be backed by SharedArrayBuffer.
- **Files modified:** `src/lib/tsa.ts`
- **Commit:** `90b9c26`

## Authentication Gates

None encountered. DFN-TSA is unauthenticated and was reachable from the developer host on first try (HTTP 200 in ~217 ms).

## Known Stubs

None. Every code path in this plan is fully wired against the real DFN-TSA service. There is intentionally no fallback chain yet (DFN-only per the plan's scope statement — fallback arrives with Plan 01-02), no `verify.sh` yet (Plan 01-02), and no Docker yet (Plan 01-03).

## Acceptance Criteria — All Met

- [x] `npm install` succeeds; `node_modules` contains all required packages.
- [x] `npm test -- --run tests/e2e/upload.happy-path.test.ts` exits 0 (GREEN).
- [x] `tsc --noEmit` exits 0 (type-check clean).
- [x] `tsconfig.json` has `"strict": true` + `"target": "ES2022"`.
- [x] `.gitignore` contains `data/` and `node_modules`.
- [x] `tests/fixtures/hello.txt` exists and is non-empty.
- [x] Bundle directory contains exactly the 6 files; all files mode 444.
- [x] `metadata.json` has exactly the 12 D-12 keys with the expected values for the fixture.
- [x] `openssl ts -verify -in <bundle>/original.tsr -data <bundle>/original.txt -CAfile <bundle>/tsa-cacert.pem` exits 0 (verified inside the test).
- [x] `original.sha256` matches `^[0-9a-f]{64}  original\.txt$` and `sha256sum -c` exits 0 (verified inside the test).
- [x] Startup warning `⚠ Phase 1 has no auth — DO NOT expose port 3000 to the public internet` is emitted (observed in test stderr).
- [x] `grep -n "-no_nonce" src/lib/tsa.ts` returns empty.
- [x] `grep -nE "ts -reply.*-text" src/lib/tsa.ts` returns empty.
- [x] `assets/tsa-certs/README.md` records SHA-256 fingerprints for every cert + the live `Verification: OK` proof.

## Threat Flags

None. The implemented surface (single `POST /api/upload`, multipart body capped at 100 MiB, outbound HTTPS to a single TSA endpoint, ULID-named writes under DATA_DIR) is exactly what the plan's `<threat_model>` registers.

## Self-Check: PASSED

All 19 files claimed in `key-files.created` exist on disk; both commits (`34a32ec`, `90b9c26`) are present in `git log`.

## Hand-Off to Plan 01-02

Next plan (`01-02-PLAN.md`) inherits a working DFN happy path and must add:

1. FreeTSA + DigiCert support in `src/lib/tsa.ts` (the `ENDPOINTS` table + `AllTsasFailed` class are already in place as placeholders).
2. A fallback orchestrator that tries DFN → FreeTSA → DigiCert and records the actual `tsa_fallback_chain` in metadata.
3. `assets/tsa-certs/freetsa.pem` + `assets/tsa-certs/digicert.pem` discovered via the same live-TSR procedure.
4. Pre-finalization `openssl ts -verify` before chmod 444 (D-09 chain — Plan 02 owns it).
5. `verify.sh` shipped inside every bundle (D-09).
