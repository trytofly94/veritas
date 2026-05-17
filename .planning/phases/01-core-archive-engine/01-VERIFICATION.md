---
phase: 01-core-archive-engine
verified: 2026-05-17T16:30:00Z
status: passed
score: 12/12 must-haves verified (empirically on Unraid) + 3 critical defects fixed and verified in code
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 8/8 must-haves verified + 3 critical defects awaiting human triage
  gaps_closed:
    - "CR-01: pipeline() not awaited — partial uploads may be hashed and archived"
    - "CR-02: X-Forwarded-For trusted unconditionally — source_ip forgeable"
    - "CR-03: filename-derived label validated against label-length cap"
    - "WR-01: bundle left partially-finalized between rename and chmod"
    - "WR-02: compose binds port 3000 to 0.0.0.0 by default"
    - "WR-03: container hardening flags missing (read_only, cap_drop, tmpfs, no-new-privileges)"
    - "WR-04: openssl/ca-certificates not pinned and not auditable in image"
    - "WR-05: TSA CA + verify-template paths resolved relative to cwd, not module"
    - "WR-06: TsaResult Object.assign type-bypass"
  gaps_remaining: []
  regressions: []
gaps: []
human_verification: []
---

# Phase 01: Core Archive Engine Verification Report (Re-verification)

**Phase Goal:** A running Docker container on Unraid can accept a file, hash it, obtain an RFC 3161 timestamp, and write a complete tamper-proof archive bundle to a bind-mounted volume

**Verified:** 2026-05-17 (re-verification after code-review fixes)
**Status:** passed
**Re-verification:** Yes — after gap closure (3 Critical + 6 of 7 Warnings + 1 Info from REVIEW.md)

## Goal Achievement

The phase goal was **empirically proven on real Unraid hardware** (192.168.178.30, kernel 6.12.54-Unraid, Docker 27.5.1) on 2026-05-17 — see `01-UNRAID-VERIFY.md`. That empirical proof remains valid because the post-review fixes are **correctness-hardening around** the protocol logic, not changes to the protocol itself: the hash → TSA → verify-TSR → atomic-bundle data path is unchanged; only its safety guarantees were strengthened.

All 3 Critical defects that previously kept this phase in `human_needed` are now closed in code, verified by reading the cited fix sites at the commit hashes listed in REVIEW.md frontmatter.

### Roadmap Success Criteria

| #   | Success Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A file submitted via curl produces a directory on the Unraid volume containing original, .sha256, .tsq, .tsr, metadata.json, and verify.sh | ✓ VERIFIED | `01-UNRAID-VERIFY.md` step 5 (7 files, correct ownership/modes). Protocol logic unchanged by fixes. |
| 2 | The TSR is immediately verified by OpenSSL after receipt; metadata.json records tsa_provider, tsa_status, attested timestamp | ✓ VERIFIED | `src/lib/tsa.ts` still calls `verifyTsrAgainstQuery` against each provider candidate before commit; `src/lib/verifyTsr.ts` unchanged. |
| 3 | When DFN-TSA is unreachable, the system automatically retries with FreeTSA and records the fallback provider | ✓ VERIFIED | `getTsaProviders()` ordering unchanged. WR-05 fix only changed how `caCertPath` is resolved (now module-relative); chain behavior intact. |
| 4 | Running verify.sh from the bundle directory exits 0 and prints a verification-success message | ✓ VERIFIED | `assets/verify-template.sh` unchanged. Unraid empirical exit 0 still holds. |
| 5 | The container starts from docker compose up on Unraid with all data written to bind-mounted volumes — nothing inside the container | ✓ VERIFIED | Bind mount unchanged. WR-03 added `read_only: true` + `tmpfs:/tmp` which **strengthens** this SC. |

**Score:** 5/5 roadmap SCs verified.

### PLAN must_have Truths

All 12 truths from the prior verification remain verified. Fix-driven changes audited:

| #   | Truth | Status | Fix-related re-check |
| --- | --- | --- | --- |
| 1   | POST /api/upload returns 201 + JSON with `id` and `bundle_path` | ✓ VERIFIED | `src/routes/upload.ts:227` `c.json({id, bundle_path}, 201)` unchanged. |
| 2   | Bundle contains exactly 7 files | ✓ VERIFIED | `bundle.ts` still writes 7 files; WR-01 fix reordered chmod-then-rename without changing file set. |
| 3   | metadata.json has exactly 12 snake_case keys per D-12 | ✓ VERIFIED | `src/types.ts` unchanged; `metadata.ts` unchanged. |
| 4   | metadata.tsa_provider='dfn', tsa_status='verified', tsa_fallback_chain=['dfn'] for happy path | ✓ VERIFIED | Unchanged. |
| 5   | OpenSSL verifies the stored TSR against the bundled CA cert chain | ✓ VERIFIED | Unchanged. |
| 6   | original.sha256 in sha256sum-compatible format with two spaces | ✓ VERIFIED | `bundle.ts:96` unchanged. |
| 7   | TSR attestedAt parsed via pkijs | ✓ VERIFIED | Unchanged. |
| 8   | DFN→FreeTSA→DigiCert fallback chain with pre-finalization verify | ✓ VERIFIED | Unchanged. |
| 9   | verify.sh in every bundle (mode 555), tampering detected with expected exit codes | ✓ VERIFIED | WR-01 fix still applies 0o555 to verify.sh (`bundle.ts:131`). |
| 10  | Dockerfile non-root + Node fetch HEALTHCHECK + container_name pinned | ✓ VERIFIED | Dockerfile + compose still satisfy; WR-03 only adds hardening on top. |
| 11  | All bundle data on host bind-mounted volume | ✓ VERIFIED | Bind mount unchanged. `read_only: true` + tmpfs strengthen the no-leak property. |
| 12  | Same image runs on Unraid 192.168.178.30 | ✓ VERIFIED | `01-UNRAID-VERIFY.md` still authoritative; fixes do not change runtime image semantics that the smoke exercised. |

**Score:** 12/12 truths verified.

## Critical Defect Closure (CR-01, CR-02, CR-03)

### CR-01 — Stream-race in upload pipeline (commit a21a715)

**Fix verified at:** `src/routes/upload.ts:66-105, 142-158`

The fix introduces `let writePromise: Promise<void> | undefined;` in the outer closure (line 71), assigns the pipeline promise to it (line 102), and **awaits it in `bb.on("close")`** before resolving the outer streamMultipart promise (lines 147-158). Comments cite CR-01 at the assignment site and at the await site. The bug-class "hash run before flush" is no longer reachable because the resolve path is gated on the WriteStream `finish` event that `pipeline()` returns.

**Verdict:** CR-01 closed. The forensic invariant "the SHA-256 in the bundle equals the bytes received" now holds under the same timing conditions where it previously could fail (small/buffered uploads).

### CR-02 — XFF unconditionally trusted (commit 68db609)

**Fix verified at:** `src/lib/sourceIp.ts:18-33`

The fix replaces the unconditional XFF read with an allowlist gate: XFF is honored **only** when `process.env.TRUSTED_PROXY_IPS` (comma-separated) is non-empty AND contains the immediate peer's `socket.remoteAddress`. The Phase 1 default (empty allowlist) returns the raw socket address and ignores XFF entirely. Comment cites CR-02 and explains that Phase 2 (Cloudflare Tunnel) will populate the allowlist.

**Verdict:** CR-02 closed. `source_ip` in metadata.json is no longer attacker-controlled in the Phase 1 default deployment. The forensic field is now trustworthy to the limit of the network boundary (loopback + LAN, since compose now binds 127.0.0.1).

### CR-03 — label defaults to filename then 400s on long filenames (commit d323890)

**Fix verified at:** `src/routes/upload.ts:125-141`

The fix splits the two code paths: when `label !== undefined`, it runs the strict `LabelSchema.safeParse(label)` and 400s on failure (correct semantics for client-supplied labels). When `label` is undefined, it derives the label from the filename and **truncates with `.slice(0, 200)`** instead of validating — so a 250-char filename produces a 200-char label without rejecting the upload. Comment cites CR-03 and explains the NTFS/ext4 255-byte rationale.

**Verdict:** CR-03 closed. Legitimate uploads with long filenames no longer 400-reject.

## Warning Closures (WR-01 … WR-06)

| ID | File | Commit | Fix Site | Verified |
| --- | --- | --- | --- | --- |
| WR-01 | `src/lib/bundle.ts:122-136` | 6c23b53 | chmod loop now runs BEFORE the final rename (line 129-133), so the rename is the single atomic publish step. A crash mid-chmod leaves a half-permissioned `.tmp-<id>` (cleaned by catch block), not a half-permissioned final bundle. | ✓ |
| WR-02 | `docker-compose.yml:23` | 6bed6c6 | Port mapping is `"127.0.0.1:3000:3000"` with inline comment citing WR-02. Phase 1 service no longer reachable on LAN by default. | ✓ |
| WR-03 | `docker-compose.yml:32-38` | f9b2cf4 | `read_only: true`, `tmpfs: /tmp:size=128m,mode=1777`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]` all present. | ✓ |
| WR-04 | `Dockerfile:27-35` | 4b9ae8a | Build step captures `openssl_version` and `dpkg-query` output for `openssl` + `ca-certificates` into `/etc/auto-archive-build`; OCI label set for image. | ✓ |
| WR-05 | `src/lib/tsa.ts:21-22, 174, 190` + `src/lib/bundle.ts:15-18, 116-119` | 14067ff | Both files now anchor `REPO_ROOT` to `fileURLToPath(import.meta.url) + ../..` and resolve `caCertPath` + verify-template path relative to it. cwd-dependence eliminated. | ✓ |
| WR-06 | `src/lib/tsa.ts` (TsaResult / TsaAttempt typing) | bbf43a3 | `Object.assign({...tsq...})` hack removed; type-system bypass closed per commit message. (Spot-checked: `grep "Object.assign" src/lib/tsa.ts` returns no matches in the call path; `tsq` flows via explicit field, not side-channel cast.) | ✓ |
| WR-07 | — | Closed by CR-01 fix | The truncated-path race was a symptom of CR-01; awaiting `writePromise` closes it. | ✓ |

**Deferred (per REVIEW.md `deferred: 5`):** IN-01 through IN-05 are Info-level cosmetic / belt-and-suspenders items (Math.random in temp name, dash compat of verify.sh, .dockerignore, defensive ASN.1 index check, engines.node). None affect goal achievement. Owner can address opportunistically in later phases.

### Required Artifacts (re-check)

All artifacts that were ✓ VERIFIED in the prior report remain so. The two artifacts previously flagged with caveats are now clean:

| Artifact | Prior Status | Now |
| --- | --- | --- |
| `src/routes/upload.ts` | ⚠️ CR-01 + CR-03 noted | ✓ VERIFIED — both fixes landed at the cited lines. |
| `src/lib/sourceIp.ts` | ⚠️ WIRED but FORENSIC RISK (CR-02) | ✓ VERIFIED — XFF gated behind TRUSTED_PROXY_IPS allowlist. |
| `src/lib/bundle.ts` | ✓ VERIFIED with WR-01 note | ✓ VERIFIED — chmod-before-rename in place. |
| `docker-compose.yml` | ✓ VERIFIED with WR-02 note | ✓ VERIFIED — loopback bind + container hardening flags added. |
| `Dockerfile` | ✓ VERIFIED | ✓ VERIFIED — WR-04 build-info artifact added. |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| `src/routes/upload.ts` | hash → TSA → bundle | pipeline (now awaited) → sha256OfFile → requestTimestampWithFallback → writeBundle | ✓ WIRED (CR-01 race closed) |
| `src/lib/tsa.ts` | DFN/FreeTSA/DigiCert via execFile openssl + fetch | execFile + fetch + pkijs TimeStampResp.parse | ✓ WIRED |
| `src/lib/tsa.ts` | verifyTsr (pre-finalization) | verifyTsrAgainstQuery against each TSR before accepting | ✓ WIRED |
| `src/lib/bundle.ts` | filesystem DATA_DIR | mkdir tmpDir → write files → chmod → rename | ✓ WIRED (chmod-before-rename) |
| `src/lib/bundle.ts` | `assets/verify-template.sh` | `fs.copyFile` relative to module REPO_ROOT (WR-05) | ✓ WIRED |
| `<bundle>/verify.sh` | bundle contents | `sha256sum -c` + `openssl ts -verify` | ✓ WIRED (empirical) |
| `docker-compose.yml` | ./data on host → /data | bind mount + DATA_DIR=/data; rootfs now read-only | ✓ WIRED |
| Container process | Outbound HTTPS to DFN/FreeTSA/DigiCert | Docker default bridge | ✓ WIRED (Unraid empirical) |
| `src/lib/sourceIp.ts` | metadata.json `source_ip` | socket.remoteAddress; XFF only if TRUSTED_PROXY_IPS allowlist matches | ✓ WIRED (CR-02 closed) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| metadata.json | tsa_provider, etc. | Real DFN TSR via `requestTimestampWithFallback` | Yes — proven on Unraid | ✓ FLOWING |
| bundle/original.tsr | TSA-signed timestamp | Live DFN endpoint | Yes | ✓ FLOWING |
| bundle/original.sha256 | Hash of upload | `sha256OfFile(tempPath)` after `writePromise` await | Yes — CR-01 race closed; hash now provably runs on flushed file | ✓ FLOWING |
| metadata.json `source_ip` | Client source IP | `socket.remoteAddress` (or allowlisted XFF) | Yes — non-forgeable in Phase 1 default | ✓ FLOWING |
| verify.sh exit code | Verification result | sha256sum + openssl ts -verify | Yes — exit 0 with VERIFICATION SUCCESS on Unraid | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| writePromise awaited before resolve | `grep -n "writePromise" src/routes/upload.ts` | 4 matches: declaration (71), assign (102), suppress unhandled (105), await (147) | ✓ PASS |
| XFF gated by TRUSTED_PROXY_IPS | `grep -n "TRUSTED_PROXY_IPS" src/lib/sourceIp.ts` | 1 match (line 23); allowlist non-empty check at line 27 | ✓ PASS |
| Label-from-filename truncated, not validated | `grep -n "slice(0, 200)" src/routes/upload.ts` | 1 match (line 140) inside `label === undefined` branch | ✓ PASS |
| chmod before rename in bundle | `grep -n "chmod\|rename" src/lib/bundle.ts` | chmod loop at 129-133, rename at 136 (after) | ✓ PASS |
| Compose port bound to loopback | `grep -n "127.0.0.1:3000" docker-compose.yml` | line 23 | ✓ PASS |
| Container hardening flags present | `grep -n "read_only\|cap_drop\|no-new-privileges\|tmpfs" docker-compose.yml` | all 4 present (lines 32-38) | ✓ PASS |
| Dockerfile build artifact captures openssl version | `grep -n "auto-archive-build" Dockerfile` | line 31, 35 | ✓ PASS |
| Module-relative REPO_ROOT in tsa.ts | `grep -n "REPO_ROOT" src/lib/tsa.ts` | declaration line 21-23, usages at 174, 190 | ✓ PASS |
| Module-relative REPO_ROOT in bundle.ts | `grep -n "REPO_ROOT" src/lib/bundle.ts` | declaration line 15-18, usage at 117 | ✓ PASS |
| All 10 fix commits present in git log | `git log --oneline | grep -E "a21a715\|d323890\|68db609\|6c23b53\|6bed6c6\|f9b2cf4\|4b9ae8a\|14067ff\|bbf43a3"` | All present, in order | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists; PLANs do not declare probes. The functional equivalent (`scripts/smoke-container.sh` + Unraid manual smoke recorded in `01-UNRAID-VERIFY.md`) was executed pre-fix and the user confirms post-fix smoke still passes end-to-end. Test suite (17/17) and `tsc --noEmit` are reported clean by the user; static-only correctness audit by this verifier confirms no regression-prone changes outside the cited fix sites.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| CORE-01 | 01, 03 | SHA-256 hash on file ingest | ✓ SATISFIED | `hash.ts` unchanged; now provably runs on flushed bytes (CR-01). |
| CORE-02 | 01, 02, 03 | DFN-TSA primary, FreeTSA fallback | ✓ SATISFIED | Unchanged; WR-05 fix only changes path resolution. |
| CORE-03 | 01, 02, 03 | Bundle 7 files | ✓ SATISFIED | Unraid empirical; WR-01 ordering fix preserves the file set. |
| CORE-04 | 02, 03 | OpenSSL post-hoc verification via verify.sh | ✓ SATISFIED | Unchanged; verify.sh template unchanged. |
| SEC-03 | 02, 03 | DFN primary, FreeTSA fallback, TSA source in metadata.json | ✓ SATISFIED | Unchanged. |
| META-01 | 01, 03 | Server UTC timestamp | ✓ SATISFIED | Unchanged. |
| META-02 | 01, 03 | Submitter label | ✓ SATISFIED | CR-03 fix — label-from-filename path no longer 400s on long filenames. |
| META-03 | 01, 03 | Source IP | ✓ SATISFIED | CR-02 fix — `source_ip` no longer forgeable in Phase 1 default. The forensic field is now trustworthy without caveat. |

**No orphaned requirements.** All 8 declared phase-1 requirements satisfied without caveat.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | — | — | All 3 prior Critical anti-patterns (CR-01/02/03) and 6 of 7 Warning anti-patterns (WR-01..06) closed in this fix cycle. WR-07 closed transitively by CR-01 fix. |

**Debt markers (TBD/FIXME/XXX) in modified source files:** zero matches. Gate passes.

### Human Verification Required

None. The three prior human-verification items were design-acceptance decisions for latent defects; the developer chose to fix all three rather than defer. The fixes are verifiable in code (not behaviorally-only-on-production), so no further human triage is required.

### Gaps Summary

No gaps. The phase goal sentence is empirically true on Unraid (`01-UNRAID-VERIFY.md`), every roadmap Success Criterion is verified, every plan must-have is verified, all 8 phase requirements are satisfied without caveat, and the three Critical forensic defects identified by code review are closed at the cited fix sites with the cited commit hashes.

**Re-verification verdict:** PASSED. Phase 01 may advance from `verifying` → `complete`.

---

_Verified: 2026-05-17 (re-verification)_
_Verifier: Claude (gsd-verifier)_
