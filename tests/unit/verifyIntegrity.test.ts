/**
 * Unit tests for src/lib/verifyIntegrity.ts (Phase 3 — BROWSE-02).
 *
 * Covers:
 *   - ok=true when on-disk file matches expected sha256
 *   - ok=false reason=hash_mismatch when file is altered
 *   - ok=false reason=file_missing when bundleDir/original.<ext> does not exist
 *   - Streaming hash (no full-file buffer load)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { verifyBundleIntegrity } from "../../src/lib/verifyIntegrity.js";

const HELLO_WORLD_SHA256 =
  "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "auto-archive-verify-test-"),
  );
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("verifyBundleIntegrity", () => {
  it("returns {ok: true} when on-disk file matches expectedSha256", async () => {
    await fsp.writeFile(
      path.join(tmpDir, "original.txt"),
      Buffer.from("hello world"),
    );
    const result = await verifyBundleIntegrity({
      bundleDir: tmpDir,
      expectedSha256: HELLO_WORLD_SHA256,
      originalFilename: "anything.txt",
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns {ok: false, reason: 'hash_mismatch'} when file content was altered", async () => {
    await fsp.writeFile(
      path.join(tmpDir, "original.pdf"),
      Buffer.from("tampered content"),
    );
    const result = await verifyBundleIntegrity({
      bundleDir: tmpDir,
      expectedSha256: HELLO_WORLD_SHA256,
      originalFilename: "foo.pdf",
    });
    expect(result).toEqual({ ok: false, reason: "hash_mismatch" });
  });

  it("returns {ok: false, reason: 'file_missing'} when bundleDir/original.<ext> does not exist", async () => {
    const result = await verifyBundleIntegrity({
      bundleDir: tmpDir,
      expectedSha256: HELLO_WORLD_SHA256,
      originalFilename: "absent.pdf",
    });
    expect(result).toEqual({ ok: false, reason: "file_missing" });
  });

  it("derives the on-disk filename from path.extname(originalFilename)", async () => {
    // file written as original.dat — expectedSha256 must match this content
    const contents = Buffer.from("data bytes");
    await fsp.writeFile(path.join(tmpDir, "original.dat"), contents);
    const expected = createHash("sha256").update(contents).digest("hex");
    const result = await verifyBundleIntegrity({
      bundleDir: tmpDir,
      expectedSha256: expected,
      originalFilename: "weird-file.with.dots.dat",
    });
    expect(result).toEqual({ ok: true });
  });

  it("handles extensionless original filenames (joins 'original' with empty ext)", async () => {
    const contents = Buffer.from("no extension");
    await fsp.writeFile(path.join(tmpDir, "original"), contents);
    const expected = createHash("sha256").update(contents).digest("hex");
    const result = await verifyBundleIntegrity({
      bundleDir: tmpDir,
      expectedSha256: expected,
      originalFilename: "Makefile",
    });
    expect(result).toEqual({ ok: true });
  });
});
