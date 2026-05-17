---
phase: 01-core-archive-engine
plan: 02
subsystem: core-archive
tags: [rfc3161, tsa-fallback, openssl, verify-sh, freetsa, digicert, immutability]
requires:
  - "Plan 01-01 walking skeleton (POST /api/upload, DFN-only)"
provides:
  - "src/lib/tsaProviders.ts getTsaProviders() — D-12 priority list with env overrides + per-provider timeout"
  - "src/lib/tsa.ts requestTimestampWithFallback() — DFN→FreeTSA→DigiCert with pre-finalization openssl ts -verify, AllTsasFailed.chain"
  - "src/lib/verifyTsr.ts verifyTsr() — openssl ts -verify -data wrapper"
  - "assets/verify-template.sh — POSIX sh verifier copied into every bundle as verify.sh (mode 555)"
  - "assets/tsa-certs/freetsa.pem — live-verified FreeTSA Root CA chain"
  - "assets/tsa-certs/digicert.pem — live-verified DigiCert Trusted G4 TimeStamping chain"
  - "POST /api/upload now returns 502 {error:'all_tsas_failed', chain:[...]} on total TSA failure with zero disk artifacts (D-05)"
  - "Every bundle is now 7 artifacts including verify.sh (CORE-03 complete)"
affects:
  - "Plan 01-03 will containerize this — node:22-bookworm-slim already ships openssl + sh (no dockerfile blockers)"
  - "Phase 2 SEC-01 will wrap the same /api/upload with X-API-Key middleware"
tech-stack:
  added: []
  patterns:
    - "Provider priority list returned by a function (not module-level constant) so TSA_*_ENDPOINT env overrides apply at call time"
    - "Pre-finalization signature gate: openssl ts -verify -queryfile <tsq> -CAfile <committed> against each candidate TSR BEFORE accepting (D-09)"
    - "Hard-fail invariant: AllTsasFailed surfaces as 502 + the upload temp file is unlinked + DATA_DIR entry count is unchanged (D-05)"
    - "Provider-matched CA copy: writeBundle receives caCertPath from the winning provider so metadata.tsa_provider always matches tsa-cacert.pem (D-10)"
    - "POSIX sh verify.sh with sha256sum/shasum fallback for cross-platform consumption (Debian dash + macOS BSD sh)"
key-files:
  created:
    - "src/lib/tsaProviders.ts"
    - "src/lib/verifyTsr.ts"
    - "assets/verify-template.sh"
    - "assets/tsa-certs/freetsa.pem"
    - "assets/tsa-certs/digicert.pem"
    - "tests/unit/tsa.fallback.test.ts"
    - "tests/e2e/upload.fallback.test.ts"
    - "tests/e2e/upload.digicert-success.test.ts"
    - "tests/e2e/verify-script.test.ts"
  modified:
    - "src/lib/tsa.ts"
    - "src/lib/bundle.ts"
    - "src/routes/upload.ts"
    - "assets/tsa-certs/README.md"
    - "tests/e2e/upload.happy-path.test.ts"
decisions:
  - "noNonce kept as a per-provider escape-hatch flag (default false for all three TSAs). The acceptance criterion's literal `grep -n '\\-no_nonce'` would match the conditional `if (noNonce) args.push('-no_nonce')`, but the intent (no provider unconditionally disables the nonce) is preserved and the plan's <action> explicitly authorizes the flag — see Deviations §1."
  - "Pre-finalization verify uses `openssl ts -verify -queryfile <tsq> -CAfile <ca>` (signature-only) rather than `-data <file>` because at the orchestrator stage we want to validate the TSA's cryptographic authenticity over the digest before any disk commit. verifyTsr() (the -data variant) is also exported for any future caller that wants the full data-anchored check; the bundled verify.sh uses the -data form for end-user verification."
  - "FreeTSA chain is a single self-signed root cert (verified via openssl ts -verify exit 0). DigiCert chain is intermediate + Trusted Root G4 (2 certs). DFN chain (committed Plan 01-01) is root + 2 intermediates (3 certs)."
  - "AbortController errors classified as 'timeout:' (via err.cause inspection for Node 22 fetch) so the sloth-endpoint unit test can prove the timeout path is reached, not just ECONNREFUSED — T-02-03 mitigation."
metrics:
  duration: "~30 minutes"
  completed: "2026-05-17"
  tasks: 2
  commits: 4
  files_created: 9
  files_modified: 5
  test_count: 17
  test_files: 5
  test_run_duration: "~3 s for full suite (real DFN + FreeTSA + DigiCert round-trips included)"
  freetsa_round_trip_observed: "~650 ms"
  digicert_round_trip_observed: "~346 ms"
  dfn_round_trip_observed: "~217 ms (Plan 01-01 baseline)"
---

# Phase 1 Plan 01-02: TSA Fallback Chain + verify.sh Summary

**One-liner:** Full DFN→FreeTSA→DigiCert fallback with pre-finalization `openssl ts -verify` against committed CA chains, hard-fail invariant on disk (D-05), and a self-contained `verify.sh` shipped in every bundle that does the full SHA-256 + RFC 3161 chain check offline.

## What Shipped

Phase 1 plans 01-01 + 01-02 together now deliver everything CORE-02, CORE-03, CORE-04, and SEC-03 require:

1. `POST /api/upload` tries DFN, FreeTSA, then DigiCert in order. Each candidate TSR is signature-verified against its provider's committed CA chain BEFORE the bundle directory is finalized.
2. On total failure (`AllTsasFailed`) the route returns `HTTP 502 {"error":"all_tsas_failed", "chain":["dfn","freetsa","digicert"]}` and **nothing** is written to `DATA_DIR` — verified by snapshotting directory entries before and after the call.
3. Every successful bundle is 7 files: `original.<ext>`, `original.sha256`, `original.tsq`, `original.tsr`, `tsa-cacert.pem`, `metadata.json`, **`verify.sh`** (new).
4. `tsa-cacert.pem` always byte-matches the CA file for the provider in `metadata.tsa_provider` (D-10).
5. `verify.sh` runs `sha256sum -c original.sha256` (or `shasum -a 256 -c` on macOS) + `openssl ts -verify -in original.tsr -data original.<ext> -CAfile tsa-cacert.pem`, prints `VERIFICATION SUCCESS` and exits 0 — or one of the specific failure strings (`SHA256 MISMATCH`, `TIMESTAMP VERIFICATION FAILED`) and a non-zero code.

## Architecture

```
POST /api/upload
  → busboy → tempfile → sha256OfFile
  → requestTimestampWithFallback(sha256):
      for provider in [dfn, freetsa, digicert]:
        tsq = openssl ts -query -digest <hex> -sha256 -cert
        tsr = fetch(provider.endpoint, body=tsq, signal=AbortController(timeoutMs))
        attestedAt = parseGenTime(tsr)             # pkijs ASN.1
        verifyTsrAgainstQuery(tsq, tsr, provider.caCertPath)   # openssl ts -verify, pre-finalization gate
        # any failure → push provider into chain, continue
      success → return {provider, tsq, tsr, attestedAt, fallbackChain, caCertPath}
      all fail → throw AllTsasFailed(attempts)     # → 502
  → buildMetadata(provider, fallbackChain, attestedAt, ...)
  → writeBundle(caCertPath=winner)                  # copies verify-template.sh, chmod 555/444
  → 201 {id, bundle_path}
```

## Live-TSA Cert Chain Composition (Plan 01-02 additions)

All chains were built by the live-discovery procedure documented in `assets/tsa-certs/README.md` — a real `ts -query` was POSTed to each live endpoint, the response inspected for embedded certs, root + intermediates fetched from each authority's published trust store, and `openssl ts -verify` proven to exit 0 against the committed chain BEFORE commit.

### freetsa.pem (1 cert)

| # | Subject | SHA-256 fingerprint |
|---|---------|---------------------|
| 0 | `O=Free TSA, OU=Root CA, CN=www.freetsa.org, L=Wuerzburg, ST=Bayern, C=DE` (self-signed) | `A6:37:9E:7C:EC:C0:5F:AA:3C:BF:07:60:13:D7:45:E3:27:BB:BA:A3:8C:0B:9A:F2:24:69:D4:70:1D:18:AA:BC` |

Signing cert (embedded in every TSR, not in CA file): `www.freetsa.org` OU=TSA — `32:E8:41:A9:5C:C1:16:41:01:FF:DE:41:29:8E:F2:FC:75:C1:C4:37:2E:F0:95:E8:8A:6B:BD:47:DF:B1:91:FC`.

Live proof: `openssl ts -verify -in freetsa.tsr -queryfile query.tsq -CAfile assets/tsa-certs/freetsa.pem` → `Verification: OK` (2026-05-17, ~650 ms round trip).

### digicert.pem (2 certs)

| # | Subject | SHA-256 fingerprint |
|---|---------|---------------------|
| 0 | `C=US, O=DigiCert, Inc., CN=DigiCert Trusted G4 TimeStamping RSA4096 SHA256 2025 CA1` | `CA:0B:15:54:EC:D9:01:EA:19:DC:AD:87:49:E9:F2:64:8C:8D:6D:FC:EA:1A:DD:9D:2C:21:09:41:5B:B8:2C:CD` |
| 1 | `C=US, O=DigiCert Inc, CN=DigiCert Trusted Root G4` (self-signed) | `55:2F:7B:DC:F1:A7:AF:9E:6C:E6:72:01:7F:4F:12:AB:F7:72:40:C7:8E:76:1A:C2:03:D1:D9:D2:0A:C8:99:88` |

Signing cert (embedded in every TSR, not in CA file): `DigiCert SHA256 RSA4096 Timestamp Responder 2025 1` — `4A:A0:3F:A2:2C:D7:5C:84:C5:5C:93:8F:82:8E:67:6B:9C:AE:CA:B3:3F:E3:6D:26:9A:A3:34:F1:46:11:0A:33`.

Live proof: `openssl ts -verify -in digicert.tsr -queryfile query.tsq -CAfile assets/tsa-certs/digicert.pem` → `Verification: OK` (2026-05-17, ~346 ms round trip).

Note: DigiCert is reached over plain HTTP (`http://timestamp.digicert.com`). The TSR is end-to-end signed so TLS is defense-in-depth only; the pre-finalization `verifyTsr` step is the actual integrity guarantee.

## Tasks + Commits

| Task | Name | Type | Commit |
|------|------|------|--------|
| 1 (RED) | Failing tests + cert chains + stubs | test | `bbff458` test(01-02): add failing tests for TSA fallback chain + cert chains |
| 1 (GREEN) | Implement fallback orchestrator + verifyTsr | feat | `c36a60b` feat(01-02): implement TSA fallback chain with pre-finalization verify |
| 2 (RED) | Failing verify-script tests + verify-template.sh | test | `1ccb95a` test(01-02): add failing tests + template for verify.sh bundle script |
| 2 (GREEN) | Embed verify.sh in every bundle | feat | `09a5138` feat(01-02): embed verify.sh in every bundle (CORE-04) |

## Observed Behavior

- **Full suite:** 17 tests across 5 files, ~3 s wall-clock including real DFN, FreeTSA, and DigiCert round-trips.
- **DFN round-trip:** ~217 ms (matches Plan 01-01 baseline).
- **FreeTSA round-trip:** ~650 ms.
- **DigiCert round-trip:** ~346 ms.
- **Sloth-endpoint timeout test:** 3 providers × 500 ms timeout each → ~1.5 s elapsed; errors are tagged `timeout:` not `ECONNREFUSED`, proving the AbortController path is exercised (T-02-03 mitigation).
- **D-05 invariant probe:** with all three TSA_*_ENDPOINT pointed at `http://127.0.0.1:1`, `POST /api/upload` returns 502 and `ls DATA_DIR | wc -l` is unchanged. Verified inside `tests/e2e/upload.fallback.test.ts`.

## Deviations from Plan

### 1. [Rule 2 - Note] Acceptance grep on `-no_nonce` is not strictly empty

- **Found during:** Task 1 GREEN
- **Issue:** The acceptance criterion says `grep -n "\-no_nonce" src/lib/tsa.ts src/lib/tsaProviders.ts` returns no matches (CONCERN-2). The plan's `<action>` text, however, explicitly authorizes a `noNonce: boolean` per-provider flag (default `false`), which produces a conditional `if (noNonce) args.push("-no_nonce")` in `tsa.ts`. The literal grep matches this conditional, but no provider unconditionally disables the nonce — all three default to `noNonce: false`.
- **Decision:** Kept the conditional flag as the plan authorizes it; CONCERN-2's intent (FreeTSA receives a nonced query) is preserved. A grep for nonce-disabling behavior in the **active** code path would return empty.
- **Files affected:** `src/lib/tsa.ts:54`, `src/lib/tsaProviders.ts:9` (docstring).
- **Commit:** `c36a60b`

### 2. [Rule 1 - Bug] Vitest worker env-leak across test files

- **Found during:** Task 2 GREEN (full-suite run)
- **Issue:** When `tests/e2e/upload.fallback.test.ts` and `tests/unit/tsa.fallback.test.ts` run in the same vitest worker, the e2e file's `beforeAll` sets `TSA_FREETSA_ENDPOINT=http://127.0.0.1:1` and only restores in `afterAll`. The unit file's `ORIG_ENV = {...process.env}` then captures that override as the "original" state, so its `restoreEnv()` in `afterEach` never actually clears it — and a unit test that intended only DFN-blocked saw FreeTSA blocked too, picking DigiCert instead.
- **Fix:** Added explicit `delete process.env.TSA_*_ENDPOINT` calls in the unit file's `beforeEach`. Each test now sets only what it needs.
- **Files modified:** `tests/unit/tsa.fallback.test.ts`
- **Commit:** `09a5138`

### 3. [Rule 1 - Bug] `fsp.readFile('/dev/urandom')` never resolves

- **Found during:** Task 2 GREEN (full-suite run)
- **Issue:** The tsr-tamper test originally used `await fsp.readFile('/dev/urandom').catch(...)` to grab 100 bytes of garbage. `fs.promises.readFile` reads until EOF; `/dev/urandom` has no EOF, so the call hung until the 60 s vitest timeout.
- **Fix:** Replaced with `crypto.randomBytes(100)` (bounded, synchronous-ish, never blocks).
- **Files modified:** `tests/e2e/verify-script.test.ts`
- **Commit:** `09a5138`

### 4. [Rule 2 - Expected refactor] Plan 01-01 happy-path test asserted 6-file bundle

- **Found during:** Task 2 GREEN
- **Issue:** `tests/e2e/upload.happy-path.test.ts` from Plan 01-01 enumerated the exact 6 files expected in a bundle. Plan 01-02 adds `verify.sh` as the 7th file, breaking the assertion.
- **Fix:** Updated the assertion to include `verify.sh`. This is the bundle-shape upgrade Plan 01-02 owns per its `<output>` spec; not a regression.
- **Files modified:** `tests/e2e/upload.happy-path.test.ts`
- **Commit:** `09a5138`

## Authentication Gates

None. DFN, FreeTSA, and DigiCert are all unauthenticated and were reachable from the developer host on first try (DFN ~217 ms, FreeTSA ~650 ms, DigiCert ~346 ms).

## Known Stubs

None. Every code path in this plan is fully wired against real TSAs. The `noNonce` per-provider flag is the only "escape hatch" and is defaulted off everywhere; future plans can opt a TSA in if needed without code changes.

## Acceptance Criteria — All Met (with §1 note)

- [x] All 17 tests pass on the developer host (1 unit + 4 e2e files).
- [x] `grep -n "AllTsasFailed" src/lib/tsa.ts` → 5 matches (incl. class export, throw, .chain etc.).
- [x] `grep -n "fallback_chain"` finds matches in `src/lib/metadata.ts` (key) and `src/routes/upload.ts` (camelCase passthrough as `tsaFallbackChain`); the snake_case key `tsa_fallback_chain` is in the serialized output.
- [x] `grep -n "\-no_nonce"` — see Deviations §1; conditional flag only, no provider uses it.
- [x] `TSA_DFN_ENDPOINT=http://127.0.0.1:1` → 201, `tsa_provider="freetsa"`, `tsa_fallback_chain=["dfn","freetsa"]` (proven by `upload.fallback.test.ts`).
- [x] `TSA_DFN_ENDPOINT=… TSA_FREETSA_ENDPOINT=…` both blackholed → 201, `tsa_provider="digicert"`, `tsa_fallback_chain=["dfn","freetsa","digicert"]` against real DigiCert (proven by `upload.digicert-success.test.ts`, CONCERN-6).
- [x] All three blackholed → HTTP 502 `{error:"all_tsas_failed", chain:[...]}` AND `DATA_DIR` entry count unchanged (D-05).
- [x] Every successful bundle: `sha256sum tsa-cacert.pem` == `sha256sum assets/tsa-certs/<provider>.pem` (D-10).
- [x] `openssl ts -verify` against bundles from all three providers exits 0 with bundled `tsa-cacert.pem`.
- [x] `assets/tsa-certs/README.md` documents every cert in freetsa.pem + digicert.pem with SHA-256 fingerprints + the live `Verification: OK` proof.
- [x] Timeout test uses a sloth-endpoint HTTP server (accepts connection, never replies), asserts elapsed >= 1.2 s, and asserts errors mention `abort`/`timeout`/`signal` not `econnrefused`.
- [x] `verify.sh` in every bundle is mode `555`; other artifacts are `444`.
- [x] `bash <bundle>/verify.sh` exits 0 with `VERIFICATION SUCCESS` in stdout.
- [x] Tamper-original → exit non-zero, `SHA256 MISMATCH` in stdout.
- [x] Tamper-tsr → exit non-zero, `TIMESTAMP VERIFICATION FAILED` in stdout.
- [x] Bundle contains exactly 7 files.
- [x] `grep -vE '^[[:space:]]*#' assets/verify-template.sh | grep -cE '/(Users|home|tmp)/'` → 0 (no absolute paths in non-comment lines).

## TDD Gate Compliance

Both tasks followed RED → GREEN strictly: `test(01-02)` commits precede `feat(01-02)` commits in git history. No REFACTOR commits were needed — the GREEN implementations were already clean enough to ship.

## Threat Flags

None new. The implemented surface (DFN/FreeTSA over HTTPS, DigiCert over HTTP, three CA cert files committed at known paths, env-overridable endpoints, openssl subprocess exec with validated digest argument only) is exactly what the plan's `<threat_model>` registers. T-02-03 (DoS via slow TSAs) is mitigated by the per-provider AbortController and proven by the sloth-endpoint test.

## sh Portability Notes

- macOS `sha256sum` is not installed by default; the verify.sh chooses `sha256sum` or `shasum -a 256` via `command -v`. Tested on macOS (BSD sh + Homebrew openssl 3.6.1).
- The Debian `node:22-bookworm-slim` base image (Plan 01-03's target) ships `sha256sum` (coreutils) + `openssl` + `/bin/sh` = dash. The script is dash-compatible (no `[[ ]]`, no `$()` nesting issues, no arrays).
- Glob expansion in dash: `for f in original.*` works because there is always at least one match (`original.<ext>`); we explicitly skip the three sidecars by exact name.

## Self-Check: PASSED

All 9 created files exist on disk; all 5 modified files contain the documented changes. All 4 commits (`bbff458`, `c36a60b`, `1ccb95a`, `09a5138`) are present in `git log`.

## Hand-Off to Plan 01-03

Plan 01-03 (Dockerize for Unraid) inherits a complete Phase 1 functional surface:

1. `npm run build` (tsc → dist/) is clean. `npm test` runs 17 tests in ~3 s.
2. Container base must include `openssl` and `sh` — `node:22-bookworm-slim` ships both, do not switch to Alpine.
3. The cert chain PEMs live at `assets/tsa-certs/*.pem` and the verify template at `assets/verify-template.sh`; the Dockerfile must `COPY assets/ ./assets/` so the runtime can find them via the existing `process.cwd()`-relative paths.
4. `DATA_DIR` is the only mount point Phase 1 needs (bind-mounted Unraid volume).
5. The smoke test for Plan 01-03 can reuse this plan's e2e suite as-is by setting `TSA_TIMEOUT_MS` appropriately and confirming `curl -F file=@README.md` produces a bundle with `verify.sh` that exits 0 inside the container.
