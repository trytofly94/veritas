/**
 * Archive list page view module (Phase 3 — BROWSE-01).
 * Renders the auth-gated `/archive` table page per UI-SPEC §Component Inventory #1.
 *
 * Markup decisions (plan-checker W1/W2/I1):
 *  - Each row's first cell contains a single semantic <a> link. The <tr> itself
 *    has no JS click/key handlers, no tabindex, and no role attribute. Hover
 *    affordance is CSS-only (cursor: pointer on tr, background change on tr:hover).
 *  - The first-cell <a> carries a title="…" attribute so truncated filenames
 *    remain recoverable on hover.
 *  - All filename strings are HTML-escaped using attribute-safe escaping (encodes
 *    &, <, >, ", ') — the same escaped string is reused for the anchor body since
 *    attribute-safe escaping is a superset of text-context escaping.
 */

import { formatRowDate, mimeToType, tsaBadgeProps } from "../lib/formatList.js";

/**
 * The fields the list view needs from each archive_entries row.
 * Intentionally a structural subset of the full schema so the route handler can
 * map a Drizzle row to this without leaking storage internals into the view.
 */
export interface ArchiveListEntry {
  id: string;
  original_filename: string;
  created_at: string;
  mime_type: string | null;
  tsa_provider: string;
  tsa_status: string;
}

/**
 * Attribute-safe HTML escape. Encodes the five characters that have special
 * meaning in either text or attribute contexts:
 *  &  → &amp;
 *  <  → &lt;
 *  >  → &gt;
 *  "  → &quot;
 *  '  → &#39;
 *
 * Order matters — & must come first so the subsequent replacements do not
 * double-encode their own ampersands.
 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmptyState(): string {
  return `      <div class="empty-state">
        <p>Noch keine Dateien archiviert.</p>
        <p class="muted">Lade eine Datei hoch, um zu beginnen.</p>
        <a class="btn btn--secondary" href="/">Datei hochladen</a>
      </div>`;
}

function renderRow(entry: ArchiveListEntry): string {
  const safeName = escapeAttr(entry.original_filename);
  const safeId = escapeAttr(entry.id);
  const date = formatRowDate(entry.created_at);
  const type = mimeToType(entry.mime_type);
  const badge = tsaBadgeProps(entry.tsa_provider, entry.tsa_status);

  // <tr> deliberately has NO JS click/key handlers, no tabindex, no role
  // attribute (plan-checker W1). The cell <a> is the sole interactive element.
  return `          <tr>
            <td><a href="/archive/${safeId}" title="${safeName}">${safeName}</a></td>
            <td>${date}</td>
            <td>${type}</td>
            <td><span class="${badge.className}">${escapeAttr(badge.label)}</span></td>
          </tr>`;
}

function renderTable(entries: ArchiveListEntry[]): string {
  const rows = entries.map(renderRow).join("\n");
  return `      <table class="archive-table">
        <thead>
          <tr>
            <th scope="col">Dateiname</th>
            <th scope="col">Datum</th>
            <th scope="col">Typ</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>`;
}

export function renderArchiveListPage({
  entries,
}: {
  entries: ArchiveListEntry[];
}): string {
  const body = entries.length === 0 ? renderEmptyState() : renderTable(entries);

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Archiv — auto-archive</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <main class="page">
    <div class="archive-page">
      <header class="archive-page__header">
        <h1>Archiv</h1>
        <a class="btn btn--secondary" href="/">Neue Datei hochladen</a>
      </header>
${body}
    </div>
  </main>
</body>
</html>`;
}
