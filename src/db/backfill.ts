import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type { Db } from "./client.js";
import { archiveEntries } from "./schema.js";
import type { Metadata } from "../types.js";

export interface BackfillResult {
  indexed: number;
  skipped: number;
}

/**
 * Scan `dataDir` on startup, parse each `metadata.json`, and INSERT OR IGNORE
 * the row into `archive_entries`.
 *
 * - Broken bundles (missing or malformed `metadata.json`) are logged and
 *   skipped — they do not abort the scan (T-02-06, T-02-07 mitigations, D-20).
 * - Directories whose name starts with ".tmp-" are ignored (writeBundle's
 *   in-progress temp dirs).
 * - Re-running over an already-populated DB is idempotent thanks to
 *   `onConflictDoNothing()` (INSERT OR IGNORE semantics, D-20).
 * - If `dataDir` does not exist yet, returns {indexed:0, skipped:0} without
 *   throwing (D-20 — acceptable on a fresh volume).
 *
 * Runs synchronously before the server binds the port (D-20).
 */
export async function backfillManifest(args: {
  db: Db;
  dataDir: string;
}): Promise<BackfillResult> {
  const t0 = Date.now();
  let indexed = 0;
  let skipped = 0;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(args.dataDir, { withFileTypes: true }) as import("node:fs").Dirent[];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Fresh volume — dataDir does not exist yet. Boot normally.
      console.info(
        `[backfill] indexed ${indexed} entries, skipped ${skipped} broken bundles in ${Date.now() - t0}ms`,
      );
      return { indexed, skipped };
    }
    throw err;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".tmp-")) continue; // ignore in-progress temp dirs

    const bundleDir = path.join(args.dataDir, ent.name);
    const metaPath = path.join(bundleDir, "metadata.json");

    try {
      const raw = await fsp.readFile(metaPath, "utf8");
      const meta = JSON.parse(raw) as Metadata;

      args.db
        .insert(archiveEntries)
        .values({
          ...meta,
          // tsa_fallback_chain is TsaProvider[] in Metadata but stored as JSON TEXT
          tsa_fallback_chain: JSON.stringify(meta.tsa_fallback_chain),
          bundle_dir: bundleDir,
        })
        .onConflictDoNothing() // INSERT OR IGNORE per D-20
        .run();

      indexed++;
    } catch (err) {
      console.warn(
        `[backfill] skip ${bundleDir}: ${(err as Error).message}`,
      );
      skipped++;
    }
  }

  console.info(
    `[backfill] indexed ${indexed} entries, skipped ${skipped} broken bundles in ${Date.now() - t0}ms`,
  );
  return { indexed, skipped };
}
