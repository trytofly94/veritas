/**
 * Integrity-verify library for the Phase 3 archive detail page (BROWSE-02).
 *
 * verifyBundleIntegrity re-hashes the on-disk `original.<ext>` file inside a
 * bundle directory and compares the streaming SHA-256 against the manifest's
 * stored expected hash.
 *
 * Behavior contract:
 *   - {ok: true}                              hash matches
 *   - {ok: false, reason: "hash_mismatch"}    file present, hash differs
 *   - {ok: false, reason: "file_missing"}     bundleDir/original.<ext> missing
 *
 * Implementation notes:
 *   - Streaming: createReadStream + crypto.createHash, no full-file buffer load
 *     (bounded by the upload cap from Phase 2; SHA-256 over 100 MB completes
 *     in ~1.5 s on Unraid hardware).
 *   - On-disk name is constructed as `original${path.extname(originalFilename)}`.
 *     `path.extname` extracts only the trailing dotted token (e.g. "../foo.txt"
 *     yields ".txt"), so adversarial filenames cannot escape bundleDir
 *     (T-03-11). bundleDir itself is server-trusted (from the DB row).
 *   - Comparison uses timingSafeEqual as defense-in-depth even though both
 *     sides come from server-trusted sources (T-03-17).
 */

import { createReadStream } from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";

export interface VerifyBundleArgs {
  bundleDir: string;
  expectedSha256: string;
  originalFilename: string;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "hash_mismatch" | "file_missing" };

export async function verifyBundleIntegrity(
  args: VerifyBundleArgs,
): Promise<VerifyResult> {
  const { bundleDir, expectedSha256, originalFilename } = args;
  const ext = path.extname(originalFilename); // includes leading "."; "" if none
  const filePath = path.join(bundleDir, `original${ext}`);

  // Existence check first — distinguishes "file_missing" from "hash_mismatch"
  try {
    await fsp.access(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, reason: "file_missing" };
    }
    throw err;
  }

  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  const computed = hash.digest("hex");

  // Length differs → cannot timingSafeEqual; fall back to plain mismatch.
  if (computed.length !== expectedSha256.length) {
    return { ok: false, reason: "hash_mismatch" };
  }
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(expectedSha256, "utf8");
  if (timingSafeEqual(a, b)) {
    return { ok: true };
  }
  return { ok: false, reason: "hash_mismatch" };
}
