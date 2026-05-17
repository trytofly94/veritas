/**
 * Archive browser route registrar (Phase 3 — BROWSE-01 + BROWSE-02).
 *
 * Mounts:
 *   GET  /archive               (BROWSE-01) — auth-gated list page
 *   GET  /archive/:id           (BROWSE-02) — auth-gated detail page (HTML errors)
 *   POST /api/archive/:id/verify (BROWSE-02) — auth-gated integrity check (JSON envelope)
 *
 * Page-vs-API auth split (plan-checker W3):
 *   - Page routes (GET) use requireSessionPage → 303 redirect on no session.
 *     Page failures use renderErrorPage / renderNotFoundPage → HTML response.
 *     The browser never sees a JSON envelope for a page request.
 *   - API routes (POST /api/...) use requireSessionApi → 401 JSON envelope.
 *     Failures use errorResponse → JSON envelope.
 *
 * Threat mitigations:
 *  - T-03-01/T-03-02/T-03-08: session middleware enforces auth server-side.
 *  - T-03-04: open-redirect mitigation inherited from requireSessionPage
 *    (only c.req.path is used for ?next=).
 *  - T-03-05/T-03-12: XSS mitigation lives in the view modules (escapeHtml on
 *    every interpolated user-provided value).
 *  - T-03-07/T-03-13: error info leak mitigation — generic German messages,
 *    full path + error logged via console.error only.
 *  - T-03-10: ULID regex applied BEFORE any DB lookup or filesystem access.
 *  - T-03-11: bundle_dir comes from the DB row (server-controlled); the
 *    original.<ext> filename is derived via path.extname which strips
 *    everything before the trailing dot.
 */

import type { Hono } from "hono";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { desc, eq } from "drizzle-orm";
import { requireSessionPage, requireSessionApi } from "../middleware/session.js";
import { errorResponse } from "../middleware/errorEnvelope.js";
import { archiveEntries } from "../db/schema.js";
import {
  renderArchiveListPage,
  type ArchiveListEntry,
} from "../views/archive-list.js";
import {
  renderArchiveDetailPage,
  renderNotFoundPage,
} from "../views/archive-detail.js";
import { renderErrorPage } from "../views/error-page.js";
import { verifyBundleIntegrity } from "../lib/verifyIntegrity.js";
import type { AppDeps } from "../server.js";

/** ULID alphabet: Crockford Base32, exactly 26 chars. */
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function registerArchive(app: Hono, deps: AppDeps): void {
  // GET /archive — auth-gated list of archive entries (BROWSE-01).
  app.get("/archive", requireSessionPage(deps), (c) => {
    try {
      const rows = deps.db
        .select()
        .from(archiveEntries)
        .orderBy(desc(archiveEntries.created_at))
        .all();

      const entries: ArchiveListEntry[] = rows.map((r) => ({
        id: r.id,
        original_filename: r.original_filename,
        created_at: r.created_at,
        mime_type: r.mime_type,
        tsa_provider: r.tsa_provider,
        tsa_status: r.tsa_status,
      }));

      return c.html(renderArchiveListPage({ entries }));
    } catch (err) {
      console.error("[archive list] db query failed:", err);
      return errorResponse(
        c,
        500,
        "INTERNAL_ERROR",
        "Fehler beim Laden des Archivs. Bitte Seite neu laden.",
      );
    }
  });

  // GET /archive/:id — auth-gated detail page (BROWSE-02). HTML responses on
  // every code path including failures (plan-checker W3).
  app.get("/archive/:id", requireSessionPage(deps), async (c) => {
    const id = c.req.param("id");

    // T-03-10: ULID regex pre-check before any DB or fs access.
    if (!ULID_REGEX.test(id)) {
      return c.html(renderNotFoundPage(), 404);
    }

    const row = deps.db
      .select()
      .from(archiveEntries)
      .where(eq(archiveEntries.id, id))
      .get();

    if (!row) {
      return c.html(renderNotFoundPage(), 404);
    }

    // Read metadata.json — also confirms disk presence before rendering.
    let meta: Record<string, unknown>;
    try {
      const raw = await fsp.readFile(
        path.join(row.bundle_dir, "metadata.json"),
        "utf8",
      );
      meta = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      console.error(
        `[archive detail] metadata.json unreadable for id=${id}:`,
        err,
      );
      return c.html(
        renderErrorPage(
          "Fehler",
          "Fehler beim Laden des Eintrags. Bitte Seite neu laden.",
        ),
        500,
      );
    }

    return c.html(
      renderArchiveDetailPage({
        entry: row,
        meta: meta as unknown as Parameters<
          typeof renderArchiveDetailPage
        >[0]["meta"],
      }),
    );
  });

  // POST /api/archive/:id/verify — auth-gated integrity verify (BROWSE-02).
  // JSON envelope responses (API endpoint).
  app.post("/api/archive/:id/verify", requireSessionApi(deps), async (c) => {
      const id = c.req.param("id");

      if (!ULID_REGEX.test(id)) {
        return errorResponse(c, 404, "NOT_FOUND", "Eintrag nicht gefunden.");
      }

      const row = deps.db
        .select()
        .from(archiveEntries)
        .where(eq(archiveEntries.id, id))
        .get();

      if (!row) {
        return errorResponse(c, 404, "NOT_FOUND", "Eintrag nicht gefunden.");
      }

      try {
        const result = await verifyBundleIntegrity({
          bundleDir: row.bundle_dir,
          expectedSha256: row.sha256,
          originalFilename: row.original_filename,
        });
        return c.json(result);
      } catch (err) {
        console.error(
          `[archive verify] unhandled error for id=${id}:`,
          err,
        );
        return errorResponse(
          c,
          500,
          "INTERNAL_ERROR",
          "Unbekannter Fehler.",
        );
      }
  });
}
