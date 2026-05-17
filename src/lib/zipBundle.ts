/**
 * D-14/D-15: ZIP bundle builder for the download endpoint.
 * Streams all 7 on-disk files plus a per-bundle VERIFY.md into an archiver ZIP.
 * Returns a Node Readable (archiver IS a Readable) — callers adapt to Web ReadableStream.
 */

import archiver from "archiver";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { renderVerifyMd } from "./verifyTemplate.js";
import type { Metadata } from "../types.js";

/**
 * Build a ZIP bundle from the on-disk bundle directory.
 *
 * D-14 order: original.<ext>, original.sha256, original.tsq, original.tsr,
 *             tsa-cacert.pem, metadata.json, verify.sh, VERIFY.md (generated).
 *
 * No temp file: archiver is a Transform stream; the consumer pipes/adapts it.
 * VERIFY.md is appended as an in-memory string (not on disk), per D-14/D-16.
 *
 * @param bundleDir - Absolute path to the bundle directory (from DB row.bundle_dir)
 * @param meta      - Parsed metadata.json contents (used for renderVerifyMd and ext)
 * @returns         - A Node Readable (archiver instance) — finalize() already called
 */
export function buildBundleZip(bundleDir: string, meta: Metadata): Readable {
  const archive = archiver("zip", { zlib: { level: 9 } });

  // Log any archive errors; the caller (route) handles HTTP-level consequences.
  archive.on("error", (err: Error) => {
    console.error("[zip] archive error:", err);
  });

  const ext = path.extname(meta.original_filename); // e.g. ".txt", ".pdf", "" for no-ext

  // D-14: Explicit per-file adds (no glob) — 7 on-disk files in canonical order
  archive.file(path.join(bundleDir, `original${ext}`), { name: `original${ext}` });
  archive.file(path.join(bundleDir, "original.sha256"), { name: "original.sha256" });
  archive.file(path.join(bundleDir, "original.tsq"), { name: "original.tsq" });
  archive.file(path.join(bundleDir, "original.tsr"), { name: "original.tsr" });
  archive.file(path.join(bundleDir, "tsa-cacert.pem"), { name: "tsa-cacert.pem" });
  archive.file(path.join(bundleDir, "metadata.json"), { name: "metadata.json" });
  archive.file(path.join(bundleDir, "verify.sh"), { name: "verify.sh" });

  // D-14/D-16: VERIFY.md generated per-bundle (not on disk; sourced from template)
  archive.append(renderVerifyMd(meta), { name: "VERIFY.md" });

  // Kick the stream — fires all file reads and flushes data into the readable side
  archive.finalize();

  return archive as unknown as Readable;
}
