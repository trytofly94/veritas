/**
 * Archive browser route registrar (Phase 3 — BROWSE-01).
 *
 * Currently mounts:
 *   GET /archive — auth-gated list of all archive entries (chronological desc).
 *
 * Reserved for plan 03-02:
 *   GET /archive/:id — single-entry detail page.
 *
 * Auth: GET /archive is protected by requireSessionPage(deps). Missing or invalid
 * session cookie → 303 redirect to /login?next=%2Farchive (T-03-01, T-03-02).
 *
 * Threat mitigations exercised here:
 *  - T-03-01 / T-03-02: session middleware enforces auth server-side.
 *  - T-03-04: open-redirect mitigation is inherited from requireSessionPage,
 *    which only uses c.req.path (not user-controlled input) when constructing
 *    the ?next= value.
 *  - T-03-05: XSS mitigation lives in renderArchiveListPage (HTML escape in
 *    both text and attribute contexts).
 *  - T-03-07: try/catch wraps the DB query so internal errors return a generic
 *    German message via the existing errorResponse envelope.
 */

import type { Hono } from "hono";
import { desc } from "drizzle-orm";
import { requireSessionPage } from "../middleware/session.js";
import { errorResponse } from "../middleware/errorEnvelope.js";
import { archiveEntries } from "../db/schema.js";
import {
  renderArchiveListPage,
  type ArchiveListEntry,
} from "../views/archive-list.js";
import type { AppDeps } from "../server.js";

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
      // T-03-07: log internal details, return generic German message to client.
      console.error("[archive list] db query failed:", err);
      return errorResponse(
        c,
        500,
        "INTERNAL_ERROR",
        "Fehler beim Laden des Archivs. Bitte Seite neu laden.",
      );
    }
  });

  // TODO(03-02): app.get("/archive/:id", requireSessionPage(deps), ...) —
  // single-entry detail page. Implemented in the next plan.
}
