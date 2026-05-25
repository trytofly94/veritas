---
phase: 01-core-archive-engine
reviewed: 2026-05-17T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/index.ts
  - src/server.ts
  - src/types.ts
  - src/routes/upload.ts
  - src/lib/hash.ts
  - src/lib/ids.ts
  - src/lib/metadata.ts
  - src/lib/sourceIp.ts
  - src/lib/tsa.ts
  - src/lib/tsaProviders.ts
  - src/lib/verifyTsr.ts
  - src/lib/bundle.ts
  - assets/verify-template.sh
  - scripts/smoke-container.sh
  - Dockerfile
  - docker-compose.yml
  - package.json
  - tsconfig.json
findings:
  critical: 3
  warning: 7
  info: 5
  total: 15
  fixed: 10
  deferred: 5
status: fixed
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-17
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the Phase 1 core archive engine: Hono multipart upload route, SHA-256 hashing, TSA fallback with pre-finalization openssl verification, atomic bundle writing, embedded verify.sh, Docker packaging, and smoke test. Code quality is generally good with clear comments and explicit decision references. Crypto and atomic-write logic is mostly sound. However, the multipart upload streaming code contains a **race condition** that can cause partial files to be hashed and archived, and the source-IP handling silently trusts attacker-controlled headers — both undermine the project's core forensic integrity promise. Docker hardening is incomplete; auth-absent service binds to 0.0.0.0 by default.

## Critical Issues

### CR-01: Race between busboy `close` and `pipeline()` flush — partial uploads may be hashed and archived

**File:** `src/routes/upload.ts:79-131`
**Issue:** Inside `bb.on("file", ...)`, the file part is piped to a write stream via:

```ts
pipeline(fileStream, out).catch((err) => fail(err));
```

The pipeline promise is never awaited. `bb.on("close")` then resolves the outer promise as soon as busboy finishes parsing — but `bb.close` can (and in practice will, on small files where everything is already buffered) fire before the write-stream `finish` event that `pipeline()` waits for. The route then immediately calls `sha256OfFile(parsed.tempPath)` on a file that may not yet be fully flushed to disk. The hash, the TSA-attested digest, and the archived bytes can disagree. This silently breaks the forensic invariant ("the SHA-256 in the bundle was the bytes the server received") for an unknown but non-zero fraction of uploads — and the bug is timing-dependent, so unit tests on small fixtures may pass while real-world uploads fail.

Additionally, if `pipeline()` rejects AFTER `bb.on("close")` has already resolved (`settled = true`), the rejection is silently swallowed by `fail()`'s early-return, leaving the route to consume a write that errored.

**Fix:** Track the pipeline promise on the outer closure and await it in `bb.on("close")` before resolving:

```ts
let writePromise: Promise<void> | undefined;

bb.on("file", (fieldname, fileStream, info) => {
  // ... setup ...
  writePromise = pipeline(fileStream, out);
  writePromise.catch(() => {}); // prevent unhandled-rejection
});

bb.on("close", () => {
  if (settled) return;
  // ... existing checks ...
  (writePromise ?? Promise.resolve())
    .then(() => {
      settled = true;
      resolve({ filename: filename!, tempPath: tempPath!, sizeBytes, label: validatedLabel });
    })
    .catch((err) => fail(err));
});
```

---

### CR-02: `X-Forwarded-For` is trusted unconditionally — attacker controls `source_ip` in the forensic metadata

**File:** `src/lib/sourceIp.ts:12-22`
**Issue:** `resolveSourceIp` accepts the first XFF value verbatim from any request and writes it into the bundle's `metadata.json` as `source_ip`. Phase 1 has no trusted reverse proxy in front of Hono — the comment even acknowledges this — yet the code still honors XFF. Any client can submit `X-Forwarded-For: 1.2.3.4` and produce a bundle whose chain-of-custody field is arbitrary. For a system whose stated purpose is court-grade evidence ("Each archived file must be cryptographically provable…"), allowing a forgeable forensic field is a critical correctness defect even if no authentication is enforced. It is worse than no field, because operators will reasonably believe it.

**Fix:** Do not honor XFF until a trusted proxy boundary exists (Phase 2). For Phase 1 either (a) always use `req.socket.remoteAddress` and ignore XFF entirely, or (b) gate XFF behind an explicit `TRUSTED_PROXY_IPS` env var that contains the immediate peer address:

```ts
export function resolveSourceIp(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } };
  const peer = env?.incoming?.socket?.remoteAddress ?? "unknown";

  const trusted = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (trusted.includes(peer)) {
    const xff = c.req.header("x-forwarded-for");
    const first = xff?.split(",")[0]?.trim();
    if (first) return first;
  }
  return peer;
}
```

---

### CR-03: `label` defaults to `original_filename`, then is rejected if filename > 200 chars — legitimate uploads can be 400-rejected

**File:** `src/routes/upload.ts:117-123` (+ `src/routes/upload.ts:22`)
**Issue:**

```ts
const LabelSchema = z.string().max(200);
// ...
let validatedLabel = label ?? filename;
const parsed = LabelSchema.safeParse(validatedLabel);
if (!parsed.success) {
  fail(new UploadError(400, `label invalid: ${parsed.error.message}`));
  return;
}
```

When the client omits the `label` field, the server quietly substitutes the filename — but then validates it against a 200-char cap that exists for the label field, not for filenames. NTFS/ext4 allow 255-byte filenames, and iOS/macOS routinely produce names longer than 200 characters (e.g., screenshots with long titles, scanner exports). A perfectly valid file submitted with no explicit label will be rejected with a misleading `label invalid:` error. Because v1 is for personal/family use with phone uploads, this will fire in production and there is no client-side defense.

**Fix:** Either truncate the filename-derived label to 200 chars, or apply two separate validators:

```ts
const labelSchema = z.string().max(200);
const validated = (label !== undefined)
  ? labelSchema.safeParse(label)
  : { success: true as const, data: (filename ?? "upload").slice(0, 200) };
if (!validated.success) { /* 400 */ return; }
const validatedLabel = validated.data;
```

## Warnings

### WR-01: Bundle is left partially-finalized on disk if process crashes between `rename(tmpDir, finalDir)` and chmod loop

**File:** `src/lib/bundle.ts:109-127`
**Issue:** Steps 8 (rename to final) and 9 (chmod to 0o444 / 0o555) are not atomic together. If the process is killed between the rename and the chmod loop (or between two chmod calls), the bundle exists at its final path with default permissions (likely 0o644). The catch block does NOT roll back the renamed directory (the comment even acknowledges this) — so a "finalized" but mis-permissioned bundle survives, violating D-07 silently. There is also no detection on subsequent startup that such a bundle exists.

**Fix:** Chmod each file in `tmpDir` BEFORE the final rename, so the rename is the only post-permissions step:

```ts
// before rename:
const tmpEntries = await fsp.readdir(tmpDir);
for (const entry of tmpEntries) {
  const mode = entry === "verify.sh" ? 0o555 : 0o444;
  await fsp.chmod(path.join(tmpDir, entry), mode);
}
await fsp.rename(tmpDir, finalDir);
```

---

### WR-02: Docker compose binds port 3000 to all interfaces (0.0.0.0) on a service with no auth

**File:** `docker-compose.yml:16-17`
**Issue:** `"3000:3000"` is shorthand for `"0.0.0.0:3000:3000"`. On a typical Unraid box this exposes the unauthenticated upload endpoint to every host on the LAN (and to anything that can reach the LAN via misconfigured firewalls, VPNs, or Docker's well-known iptables bypass of UFW). The README/compose warning ("DO NOT expose port 3000 to the public internet") is necessary but not sufficient — defaults should be safe.

**Fix:** Bind to loopback only and document a reverse-proxy or tunnel for LAN access:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

If the operator genuinely wants LAN access in Phase 1, they edit the compose file consciously.

---

### WR-03: Container hardening missing — no `read_only`, no `cap_drop`, no `security_opt`, no `tmpfs` for /tmp

**File:** `docker-compose.yml:7-31` / `Dockerfile:17-52`
**Issue:** The compose service has none of the standard Docker hardening flags. The container runs with full Linux capabilities and a writable rootfs even though the only writable path needed at runtime is `/data` (bind) and `/tmp` (for openssl tsr/tsq + multipart temp files). Given the threat model in CLAUDE.md ("files contain potentially sensitive evidence"), defense-in-depth is appropriate.

**Fix:**

```yaml
services:
  veritas:
    read_only: true
    tmpfs:
      - /tmp:size=128m,mode=1777
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
```

---

### WR-04: `Dockerfile` `apt-get install openssl ca-certificates` is unpinned — image is not reproducible

**File:** `Dockerfile:21-24`
**Issue:** `apt-get install -y --no-install-recommends openssl ca-certificates` pulls whatever apt ships at build time. Two builds of the same Git SHA can produce different openssl binaries (and different verify behavior). For a court-evidence system, a reproducible image is a documentation virtue at minimum.

**Fix:** Pin major versions (e.g. `openssl=3.0.*`) or record `openssl version` output as a build artifact / image label. At minimum, capture the output of `apt list --installed openssl ca-certificates` into an image LABEL.

---

### WR-05: `path.resolve(process.cwd(), p.caCertPath)` will fail silently if the service is launched from a different working directory

**File:** `src/lib/tsa.ts:161, 177` and `src/lib/bundle.ts:103-107`
**Issue:** Both the CA-cert path lookup and the verify-template path are derived from `process.cwd()`. In the published Docker image, `WORKDIR /app` is set so this works — but anyone running `node dist/index.js` from another directory (systemd units commonly default to `/`), or anyone bundling this with a process supervisor that changes cwd, gets a `ENOENT` at upload time. The error surfaces as a generic 502 "all_tsas_failed" with `verify-failed: ENOENT` per provider — the operator has no obvious clue.

**Fix:** Resolve relative to a module-relative anchor:

```ts
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// then: path.resolve(REPO_ROOT, p.caCertPath)
```

Same for `assets/verify-template.sh` in `bundle.ts`.

---

### WR-06: `Object.assign({ provider: provider.id, tsq, tsr, attestedAt })` returns a plain object cast to `TsaResult` — type-system bypass

**File:** `src/lib/tsa.ts:108`
**Issue:** `requestTimestampFromProvider` is declared `Promise<TsaResult>`, but `TsaResult` does not contain `tsq` (per `src/types.ts:23-28`). The implementation packs `tsq` into the returned object via `Object.assign` and downstream callers (line 159, 173) read it via `(attempt as TsaResult & { tsq: Buffer }).tsq` — a structural lie. If a future refactor relies on the declared type, `tsq` will be silently dropped and pre-finalization verify will throw `ENOENT` or run against `undefined`. The comment "Hack: stuff tsq into a side channel" admits this.

**Fix:** Add `tsq: Buffer` to the `TsaResult` interface (it is semantically part of a TSA result anyway, since the bundle stores it), or introduce an internal `TsaAttempt` type:

```ts
interface TsaAttempt extends TsaResult { tsq: Buffer; }
async function requestTimestampFromProvider(...): Promise<TsaAttempt> { ... }
```

---

### WR-07: Multipart `truncated` is signaled correctly but the partial temp file is not unlinked until after `cleanup()` runs in `fail()` — and `pipeline()` may continue writing after busboy emitted `limit`

**File:** `src/routes/upload.ts:93-95, 67-71`
**Issue:** When busboy fires `limit`, it sets `truncated = true` and (per busboy semantics) stops feeding the stream. The pipeline to `out` then ends cleanly with a truncated file on disk. That file is unlinked by `cleanup()` in `fail()` — fine. But because pipeline is not awaited (see CR-01), `bb.on("close")` may fire before pipeline rejects on its own end-of-stream condition. There is a window where a truncated file is reported as full, then immediately unlinked — but the 413 may race with the resolve path. Fixing CR-01 closes this race as well; called out separately because the truncated path has its own correctness requirement (size reported in any 413 should be the actual byte count received, which `sizeBytes` accurately reflects because it is summed in `.on("data")`).

**Fix:** Implement CR-01 fix (await pipeline before resolve/reject from `bb.on("close")`).

## Info

### IN-01: `Math.random()` in temp-file naming is not cryptographically random

**File:** `src/routes/upload.ts:87`
**Issue:** `Math.random().toString(36).slice(2)` is V8's PRNG, not CSPRNG. Combined with `process.pid` and `Date.now()` collisions are extremely unlikely in /tmp for a single process, but the codebase has `crypto.randomBytes` available (used in `verifyTsr.ts:35` and `tsa.ts:197`). Use it consistently to avoid setting a bad pattern.

**Fix:** `crypto.randomBytes(8).toString("hex")` instead of `Math.random().toString(36).slice(2)`.

---

### IN-02: `smoke-container.sh` runs `bash verify.sh` but the script shebang is `#!/bin/sh`

**File:** `scripts/smoke-container.sh:122`
**Issue:** `verify.sh` advertises strict POSIX-sh portability and is run under bash by the smoke test. The smoke therefore does not actually exercise dash compatibility (the most likely production shell on Debian/Alpine). A subtle bashism could slip in and pass smoke.

**Fix:** `sh "${HOST_BUNDLE}/verify.sh"` (or run twice — once with each shell — if both are required).

---

### IN-03: Missing `.dockerignore` not visible in tree — repo may leak `.planning/`, `data/`, `node_modules/`, `.git/` into build context

**File:** `Dockerfile` build context
**Issue:** Without a `.dockerignore`, every `docker build` rehydrates the entire repo into the context. Aside from build-time cost, this can copy a developer's local `./data` (with their bundles) into image layers if any future `COPY . .` slips in. The current Dockerfile only copies named paths so it's safe today, but the safety is one careless edit away.

**Fix:** Add a `.dockerignore` listing at minimum: `.git`, `.planning`, `data`, `node_modules`, `dist`, `coverage`, `tests`, `*.log`.

---

### IN-04: `parseGenTime` assumes TSTInfo.genTime is at index 4 with no defensive check on intermediate fields

**File:** `src/lib/tsa.ts:323`
**Issue:** `const genTimeNode = tstSeq.valueBlock.value[4];` works for spec-compliant TSRs (TSTInfo order: version, policy, messageImprint, serialNumber, genTime). But the code does not validate that field 0 is the expected INTEGER version or that prior fields look right. A malformed-but-parseable ASN.1 stream could land arbitrary content at index 4 and `toDate()` would throw with a confusing message. Low risk since we control the TSAs we trust, and a verify-failure on bad TSRs catches the security case.

**Fix:** Validate `tstSeq.valueBlock.value.length >= 5` and that the genTime node is a `GeneralizedTime` ASN.1 tag (which the `toDate` check partially does) before extracting.

---

### IN-05: `package.json` lacks `engines.node` declaration despite hard dependency on Node 22 (built-in fetch, AbortController behavior)

**File:** `package.json`
**Issue:** Code uses Node 22's stable `fetch` and the @hono/node-server adapter. Running on Node 18 or 20 would behave subtly differently around fetch abort semantics. Without `engines.node`, npm install on the wrong version succeeds silently.

**Fix:**

```json
"engines": { "node": ">=22.0.0" }
```

---

_Reviewed: 2026-05-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
