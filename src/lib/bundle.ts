import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Metadata, TsaResult } from "../types.js";

export interface WriteBundleArgs {
  id: string;
  original: { filename: string; sourcePath: string };
  sha256Hex: string;
  tsa: TsaResult;
  metadata: Metadata;
  caCertPath: string;
  dataDir: string;
}

/**
 * Atomically write a complete bundle directory under DATA_DIR.
 *
 * Algorithm:
 *  1. Derive the extension from the uploaded filename.
 *  2. Create DATA_DIR/.tmp-<id>/.
 *  3. Move (rename) the already-on-disk uploaded temp file into the bundle
 *     as `original<ext>`. Fall back to a streaming copy if rename fails
 *     across filesystems (EXDEV).
 *  4. Write `original.sha256` in `sha256sum -c` format: `<hex>  original<ext>\n`
 *     (TWO spaces, per BLOCKER-3).
 *  5. Write `original.tsq`, `original.tsr`.
 *  6. Copy the CA cert chain into the bundle as `tsa-cacert.pem`.
 *  7. Write `metadata.json` with 2-space indent.
 *  8. Atomically rename .tmp-<id> → <id>.
 *  9. chmod 0o444 every file in the finalized directory (D-07).
 * 10. Return the absolute bundle path.
 *
 * On any failure mid-write, the .tmp-<id> directory is removed so no partial
 * bundle survives (D-05).
 */
export async function writeBundle(args: WriteBundleArgs): Promise<string> {
  const {
    id,
    original,
    sha256Hex,
    tsa,
    metadata,
    caCertPath,
    dataDir,
  } = args;

  await fsp.mkdir(dataDir, { recursive: true });
  const tmpDir = path.join(dataDir, `.tmp-${id}`);
  const finalDir = path.join(dataDir, id);

  // Clean any stale tmp from a crashed prior run with the same id (unlikely
  // but defensive — ULID makes collisions astronomically unlikely).
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await fsp.mkdir(tmpDir, { recursive: true });

  const ext = path.extname(original.filename); // includes leading "."; "" for no-ext
  const originalName = `original${ext}`;
  const originalDest = path.join(tmpDir, originalName);

  try {
    // Step 3 — move the upload's temp file into the bundle (same-fs rename,
    // streaming copy fallback for cross-fs).
    try {
      await fsp.rename(original.sourcePath, originalDest);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        await pipeline(
          fs.createReadStream(original.sourcePath),
          fs.createWriteStream(originalDest),
        );
        await fsp.unlink(original.sourcePath);
      } else {
        throw err;
      }
    }

    // Step 4 — sha256sum -c compatible sidecar (two spaces between hex and name).
    await fsp.writeFile(
      path.join(tmpDir, "original.sha256"),
      `${sha256Hex}  ${originalName}\n`,
      "utf8",
    );

    // Step 5 — TSA artifacts
    await fsp.writeFile(path.join(tmpDir, "original.tsq"), tsa.tsq);
    await fsp.writeFile(path.join(tmpDir, "original.tsr"), tsa.tsr);

    // Step 6 — CA chain for offline verification
    await fsp.copyFile(caCertPath, path.join(tmpDir, "tsa-cacert.pem"));

    // Step 7 — metadata
    await fsp.writeFile(
      path.join(tmpDir, "metadata.json"),
      JSON.stringify(metadata, null, 2) + "\n",
      "utf8",
    );

    // Step 7b — embed verify.sh (CORE-04, D-09). Copied from the committed
    // assets/verify-template.sh so every bundle on disk is self-verifying.
    const verifyTemplatePath = path.resolve(
      process.cwd(),
      "assets/verify-template.sh",
    );
    await fsp.copyFile(verifyTemplatePath, path.join(tmpDir, "verify.sh"));

    // Step 8 — atomic finalize
    await fsp.rename(tmpDir, finalDir);

    // Step 9 — chmod files (D-07). verify.sh needs +x for the user to run it
    // directly; every other artifact is 0o444 (read-only).
    const entries = await fsp.readdir(finalDir);
    for (const entry of entries) {
      const mode = entry === "verify.sh" ? 0o555 : 0o444;
      await fsp.chmod(path.join(finalDir, entry), mode);
    }

    return finalDir;
  } catch (err) {
    // Roll back: never leave a partial bundle on disk (D-05).
    await fsp.rm(tmpDir, { recursive: true, force: true });
    // Also clean a possibly-finalized half-bundle if we crashed after rename
    // but before chmod (chmod errors should not abort but be conservative).
    throw err;
  }
}
