/**
 * Archive detail page view module (Phase 3 — BROWSE-02).
 * Renders `/archive/:id` per UI-SPEC §Component Inventory #3 + §Integrity
 * Verification Component + §Copywriting Contract.
 *
 * Decisions:
 *  - All user-controlled values (filename, label, source_ip, mime_type) are
 *    HTML-escaped via the shared escapeHtml helper (T-03-12).
 *  - tsa_attested_at is the canonical DB column name (plan-checker W4); the
 *    rendered HTML contains NO occurrence of the obsolete pre-W4 field name
 *    (now removed everywhere).
 *  - Copy-to-clipboard buttons carry the full value in a `data-value` attribute
 *    so Alpine can read it without re-querying the DOM (`@click="copyValue($el.dataset.value, $event)"`).
 *  - Alpine x-data wired on the inner cards only — page shell renders without JS.
 *  - aria-live="polite" on the verify result region announces success/failure
 *    to assistive tech.
 *  - Download CTA uses `.btn--primary` (accent green) per UI-SPEC Layout Contract.
 */

import { escapeHtml } from "../lib/escapeHtml.js";
import { formatBytes, truncateSha } from "../lib/formatDetail.js";
import { tsaBadgeProps } from "../lib/formatList.js";

/** Drizzle row shape for archive_entries (structural subset used by the view). */
export interface ArchiveDetailEntry {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  label: string;
  source_ip: string;
  tsa_provider: string;
  tsa_status: string;
  tsa_attested_at: string;
  tsa_fallback_chain: string;
  bundle_dir: string;
}

/** metadata.json shape (structural subset used by the view). */
export interface ArchiveDetailMeta {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  label: string;
  source_ip: string;
  tsa_provider: string;
  tsa_status: string;
  tsa_attested_at: string;
  tsa_fallback_chain: string[];
}

export interface ArchiveDetailViewModel {
  entry: ArchiveDetailEntry;
  meta: ArchiveDetailMeta;
}

function row(label: string, value: string, extra: string = ""): string {
  return `        <div class="confirm-row">
          <div class="confirm-label">${escapeHtml(label)}</div>
          <div class="confirm-value">${value}${extra}</div>
        </div>`;
}

function copyButton(value: string): string {
  return ` <button type="button" class="btn btn--ghost" data-value="${escapeHtml(value)}" @click="copyValue($event.target.dataset.value, $event)">Kopieren</button>`;
}

export function renderArchiveDetailPage(vm: ArchiveDetailViewModel): string {
  const { entry, meta } = vm;
  const safeId = escapeHtml(entry.id);
  const safeFilename = escapeHtml(entry.original_filename);
  const badge = tsaBadgeProps(entry.tsa_provider, entry.tsa_status);
  const safeBadgeLabel = escapeHtml(badge.label);

  const submitterLabel = meta.label && meta.label.trim() !== ""
    ? escapeHtml(meta.label)
    : "—";

  const tsaAttestedAt = entry.tsa_attested_at || meta.tsa_attested_at || "";
  const tsaAttestedRendered =
    tsaAttestedAt && entry.tsa_status === "ok" || (tsaAttestedAt && entry.tsa_status === "verified")
      ? escapeHtml(tsaAttestedAt)
      : "—";

  const sizeRendered = escapeHtml(formatBytes(entry.size_bytes));
  const shaTruncated = escapeHtml(truncateSha(entry.sha256));
  const shaFull = entry.sha256;

  const idValueHtml = `<code class="ulid">${safeId}</code>` + copyButton(entry.id);
  const shaValueHtml = `<code class="ulid">${shaTruncated}</code>` + copyButton(shaFull);

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeFilename} — Veritas</title>
  <link rel="stylesheet" href="/static/style.css?v=2">
  <!-- archive-detail.js must load before alpine so window.verifyIntegrity / window.copyState exist when Alpine fires alpine:init -->
  <script defer src="/static/archive-detail.js"></script>
  <script defer src="/static/alpine.min.js"></script>
</head>
<body>
  <nav class="nav">
    <a class="nav__brand" href="/">Veritas</a>
    <div class="nav__links">
      <a class="nav__link" href="/">Hochladen</a>
      <a class="nav__link nav__link--active" href="/archive">Archiv</a>
    </div>
  </nav>
  <main class="page archive-detail-page">
    <a class="back-link" href="/archive">← Zurück zum Archiv</a>
    <h1 class="archive-detail__filename">${safeFilename}</h1>
    <div class="archive-detail__meta-row">
      <span class="${badge.className}">${safeBadgeLabel}</span>
      <time>${escapeHtml(meta.created_at)}</time>
    </div>

    <section class="card" x-data="copyState()">
${row("Archiv-ID", idValueHtml)}
${row("Bezeichnung", submitterLabel)}
${row("Dateigröße", sizeRendered)}
${row("Dateityp", escapeHtml(entry.mime_type))}
${row("SHA-256", shaValueHtml)}
${row("Server-Zeitstempel", escapeHtml(meta.created_at))}
${row("TSA-Zeitstempel", tsaAttestedRendered)}
${row("TSA-Anbieter", escapeHtml(entry.tsa_provider))}
${row("Quell-IP", escapeHtml(entry.source_ip))}
    </section>

    <section class="card" x-data="verifyIntegrity('${safeId}')">
      <h2>Integrität prüfen</h2>
      <p class="muted">Prüft SHA-256 der gespeicherten Datei gegen den archivierten Hash.</p>
      <button type="button" class="btn btn--secondary" :disabled="state==='checking'" @click="run()" x-text="state==='checking' ? 'Integrität wird geprüft …' : 'Integrität jetzt prüfen'">Integrität jetzt prüfen</button>
      <div class="verify-result" aria-live="polite" x-show="state !== 'idle' && state !== 'checking'">
        <template x-if="state==='ok'">
          <div>
            <div class="verify-result__ok">✓ Integrität bestätigt</div>
            <div class="verify-result__hint">SHA-256 stimmt überein.</div>
          </div>
        </template>
        <template x-if="state==='fail'">
          <div>
            <div class="verify-result__fail">✗ Integritätsfehler</div>
            <div class="verify-result__hint">SHA-256 weicht ab. Datei möglicherweise verändert. Bitte Original-Bundle prüfen.</div>
          </div>
        </template>
        <template x-if="state==='error'">
          <div class="verify-result__fail">Prüfung fehlgeschlagen. Bitte erneut versuchen.</div>
        </template>
      </div>
    </section>

    <a class="btn btn--primary" href="/api/download/${safeId}">Archiv-Bundle herunterladen</a>
  </main>
</body>
</html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nicht gefunden — Veritas</title>
  <link rel="stylesheet" href="/static/style.css?v=2">
</head>
<body>
  <main class="page archive-detail-page">
    <div class="empty-state">
      <p>Eintrag nicht gefunden.</p>
      <a class="btn btn--secondary" href="/archive">← Zurück zum Archiv</a>
    </div>
  </main>
</body>
</html>`;
}
