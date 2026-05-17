/**
 * Server-rendered HTML error page (Phase 3 — BROWSE-02).
 *
 * Used by page-context route handlers when something goes wrong server-side
 * (e.g. metadata.json missing on disk for an existing row). The browser
 * receives an HTML 500 instead of a JSON envelope so a user navigating to a
 * broken detail page sees a readable German message rather than raw JSON
 * (plan-checker W3).
 *
 * The status code is the caller's responsibility: `c.html(renderErrorPage(...), 500)`.
 *
 * No JavaScript / no Alpine — the page must render even when JS fails.
 */

import { escapeHtml } from "../lib/escapeHtml.js";

export function renderErrorPage(title: string, message: string): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} — auto-archive</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
  <main class="page archive-detail-page">
    <div class="empty-state">
      <p>${safeMessage}</p>
      <a class="btn btn--secondary" href="/archive">← Zurück zum Archiv</a>
    </div>
  </main>
</body>
</html>`;
}
