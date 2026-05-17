/**
 * D-12/D-13/D-14/D-15: GET /api/download/:id — verifiable ZIP bundle download.
 *
 * Auth: X-API-Key OR session cookie (authOrApiKey middleware, D-12).
 * Response: streamed ZIP (D-15: no length header), Cache-Control: no-store.
 * Filename: {label-slug}-{id}.zip (D-13).
 * Contents: 7 on-disk files + per-bundle VERIFY.md (D-14).
 *
 * Error cases (D-23/D-24):
 *  - Invalid ULID format → 404 NOT_FOUND
 *  - Unknown id (not in DB) → 404 NOT_FOUND
 *  - Row exists but bundle_dir missing/corrupted on disk → 500 INTERNAL_ERROR
 *  - No auth → 401 UNAUTHORIZED (handled by authOrApiKey middleware)
 */

import type { Hono } from "hono";
import { Readable } from "node:stream";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { archiveEntries } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { authOrApiKey } from "../middleware/authOrApiKey.js";
import { slugifyLabel } from "../lib/slug.js";
import { buildBundleZip } from "../lib/zipBundle.js";
import { errorResponse } from "../middleware/errorEnvelope.js";
import type { AppDeps } from "../server.js";
import type { Metadata } from "../types.js";

/** ULID alphabet: Crockford Base32, exactly 26 chars */
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function registerDownload(app: Hono, deps: AppDeps): void {
  app.get("/api/download/:id", authOrApiKey(deps), async (c) => {
    const id = c.req.param("id");

    // T-02-28: ULID regex pre-check before any DB access (path traversal guard)
    if (!ULID_REGEX.test(id)) {
      return errorResponse(c, 404, "NOT_FOUND", "Archiv nicht gefunden.");
    }

    // DB lookup
    const row = deps.db
      .select()
      .from(archiveEntries)
      .where(eq(archiveEntries.id, id))
      .get();

    if (!row) {
      return errorResponse(c, 404, "NOT_FOUND", "Archiv nicht gefunden.");
    }

    // Read metadata.json — also confirms disk presence before streaming begins.
    // On ENOENT or parse failure: 500 INTERNAL_ERROR (row-without-disk case).
    let meta: Metadata;
    try {
      const raw = await fsp.readFile(
        path.join(row.bundle_dir, "metadata.json"),
        "utf8",
      );
      meta = JSON.parse(raw) as Metadata;
    } catch (err) {
      console.error(`[download] bundle_dir missing or metadata.json unreadable for id=${id}:`, err);
      return errorResponse(c, 500, "INTERNAL_ERROR", "Unbekannter Fehler.");
    }

    // D-13: ZIP filename from slugified label
    const slug = slugifyLabel(row.label);
    const filename = `${slug}-${id}.zip`;

    // D-15: Set headers — streaming response, no length header.
    // T-02-29: Cache-Control: no-store prevents intermediary caching.
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Cache-Control", "no-store");

    // Build the ZIP stream (archiver kicks finalize internally)
    const readable = buildBundleZip(row.bundle_dir, meta);

    // Adapt Node Readable → Web ReadableStream for Hono's Response
    return new Response(Readable.toWeb(readable) as ReadableStream, {
      headers: c.res.headers,
    });
  });
}
