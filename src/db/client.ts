import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * WR-05 pattern: resolve module-relative paths so the service works regardless
 * of the working directory it is launched from. At runtime this file lives at
 * `dist/db/client.js` and at dev/test time at `src/db/client.ts`; both
 * layouts have the repo root two levels up, where `src/db/migrations/` lives.
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export type Db = BetterSQLite3Database;

/**
 * Open (or create) the SQLite database at `dbPath`, configure WAL mode for
 * better concurrent read performance, and apply the initial migration using
 * the raw SQL file directly (avoids drizzle-kit journal file complexity).
 *
 * The migration uses IF NOT EXISTS guards so it is idempotent — safe to run
 * on every startup (D-18).
 */
export function openDb(dbPath: string): Db {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");

  // Apply migration via raw SQL exec — idempotent due to IF NOT EXISTS guards.
  // This is the documented fallback from D-18 that avoids drizzle-kit's
  // meta/_journal.json requirement while being fully equivalent for a single
  // initial migration.
  const migrationSql = fs.readFileSync(
    path.resolve(REPO_ROOT, "src/db/migrations/0000_init.sql"),
    "utf8",
  );
  sqlite.exec(migrationSql);

  const db = drizzle(sqlite);
  return db;
}
