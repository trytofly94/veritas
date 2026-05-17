import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { openDb } from "../../src/db/client.js";
import { backfillManifest } from "../../src/db/backfill.js";
import { archiveEntries } from "../../src/db/schema.js";
import type { Metadata } from "../../src/types.js";

/**
 * Build a minimal synthetic Metadata fixture so the test is not coupled to any
 * specific on-disk bundle.  tsa_fallback_chain is an array here (in-memory
 * shape); backfill will JSON.stringify it before inserting.
 */
function makeMetadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    id: "01HXYZ1234567890ABCDEFGHIJ",
    original_filename: "test.txt",
    mime_type: "text/plain",
    size_bytes: 11,
    sha256: "a".repeat(64),
    created_at: "2026-01-01T00:00:00.000Z",
    label: "test label",
    source_ip: "127.0.0.1",
    tsa_provider: "dfn",
    tsa_status: "verified",
    tsa_attested_at: "2026-01-01T00:00:01.000Z",
    tsa_fallback_chain: [],
    ...overrides,
  };
}

async function createBundleDir(
  dataDir: string,
  id: string,
  meta: Metadata,
): Promise<string> {
  const bundleDir = path.join(dataDir, id);
  await fsp.mkdir(bundleDir, { recursive: true });
  await fsp.writeFile(
    path.join(bundleDir, "metadata.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  return bundleDir;
}

let dataDir: string;
let dbPath: string;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aa-backfill-"));
  dbPath = path.join(dataDir, "manifest.sqlite");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe("backfillManifest", () => {
  it("Test 1: empty dataDir returns {indexed:0, skipped:0} without throwing", async () => {
    const db = openDb(dbPath);
    const result = await backfillManifest({ db, dataDir });
    expect(result).toEqual({ indexed: 0, skipped: 0 });
  });

  it("Test 2: 1 valid bundle is indexed; row has correct bundle_dir and tsa_fallback_chain", async () => {
    const db = openDb(dbPath);
    const meta = makeMetadata({ tsa_fallback_chain: ["dfn"] as any });
    const bundleDir = await createBundleDir(dataDir, meta.id, meta);

    const result = await backfillManifest({ db, dataDir });
    expect(result).toEqual({ indexed: 1, skipped: 0 });

    const rows = db.select().from(archiveEntries).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].bundle_dir).toBe(bundleDir);
    // tsa_fallback_chain stored as JSON string
    expect(rows[0].tsa_fallback_chain).toBe(JSON.stringify(["dfn"]));
  });

  it("Test 3: running backfill twice over 2 bundles stays at 2 rows (idempotent / ON CONFLICT DO NOTHING)", async () => {
    const db = openDb(dbPath);
    const meta1 = makeMetadata({ id: "01HXYZ1234567890ABCDEFGHIJ" });
    const meta2 = makeMetadata({ id: "01HXYZ1234567890ABCDEFGHI2", sha256: "b".repeat(64) });
    await createBundleDir(dataDir, meta1.id, meta1);
    await createBundleDir(dataDir, meta2.id, meta2);

    const r1 = await backfillManifest({ db, dataDir });
    expect(r1.indexed).toBe(2);

    const r2 = await backfillManifest({ db, dataDir });
    expect(r2.indexed).toBe(2);

    const rows = db.select().from(archiveEntries).all();
    expect(rows).toHaveLength(2);
  });

  it("Test 4: bundle with missing metadata.json contributes to skipped; console.warn called with bundle dir", async () => {
    const db = openDb(dbPath);
    // Create a directory but no metadata.json
    const bundleDir = path.join(dataDir, "ORPHAN123456789012345678901");
    await fsp.mkdir(bundleDir, { recursive: true });

    const warnSpy = vi.spyOn(console, "warn");
    const result = await backfillManifest({ db, dataDir });
    expect(result).toEqual({ indexed: 0, skipped: 1 });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain(bundleDir);
  });

  it("Test 5: bundle with malformed metadata.json (not JSON) contributes to skipped; console.warn called", async () => {
    const db = openDb(dbPath);
    const bundleDir = path.join(dataDir, "BROKEN123456789012345678901");
    await fsp.mkdir(bundleDir, { recursive: true });
    await fsp.writeFile(path.join(bundleDir, "metadata.json"), "not-json!!!", "utf8");

    const warnSpy = vi.spyOn(console, "warn");
    const result = await backfillManifest({ db, dataDir });
    expect(result).toEqual({ indexed: 0, skipped: 1 });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain(bundleDir);
  });

  it("Test 6: .tmp- prefixed directories are ignored (neither indexed nor skipped)", async () => {
    const db = openDb(dbPath);
    // Create a .tmp- directory (writeBundle's temp dirs)
    const tmpDir = path.join(dataDir, ".tmp-01HXYZ1234567890ABCDEFGHIJ");
    await fsp.mkdir(tmpDir, { recursive: true });
    // No metadata.json inside — if it were processed it would be skipped

    const result = await backfillManifest({ db, dataDir });
    expect(result).toEqual({ indexed: 0, skipped: 0 });
  });

  it("Test 7: log line matches expected format", async () => {
    const db = openDb(dbPath);
    const meta = makeMetadata();
    await createBundleDir(dataDir, meta.id, meta);

    const infoSpy = vi.spyOn(console, "info");
    await backfillManifest({ db, dataDir });

    const logLine = infoSpy.mock.calls.find((call) =>
      String(call[0]).startsWith("[backfill]"),
    )?.[0] as string;
    expect(logLine).toBeDefined();
    expect(logLine).toMatch(
      /^\[backfill\] indexed \d+ entries, skipped \d+ broken bundles in \d+ms$/,
    );
  });
});
