/**
 * Unit tests for src/views/archive-detail.ts and src/views/error-page.ts.
 * Covers UI-SPEC §Component Inventory #3 contract:
 *   - All 9 metadata labels rendered verbatim
 *   - XSS-safe escaping on every user-provided field
 *   - tsa_attested_at fallback handling (empty → "—")
 *   - Alpine x-data hooks for verifyIntegrity + copyValue
 *   - aria-live polite announcement region
 *   - script src wiring for /static/archive-detail.js
 *   - 404 (renderNotFoundPage) + 500 (renderErrorPage) helpers
 *   - W4 regression guard: no occurrence of obsolete "tsa_attested_time"
 */

import { describe, it, expect } from "vitest";
import {
  renderArchiveDetailPage,
  renderNotFoundPage,
  type ArchiveDetailViewModel,
} from "../../src/views/archive-detail.js";
import { renderErrorPage } from "../../src/views/error-page.js";

function vm(
  overrides: Partial<ArchiveDetailViewModel["entry"] & ArchiveDetailViewModel["meta"]> = {},
): ArchiveDetailViewModel {
  const baseEntry = {
    id: "01ABCDEFGHJKMNPQRSTVWXYZ12",
    original_filename: "document.pdf",
    mime_type: "application/pdf",
    size_bytes: 186777,
    sha256: "a".repeat(64),
    created_at: "2026-05-17T14:32:03Z",
    label: "Test Label",
    source_ip: "192.168.178.1",
    tsa_provider: "dfn",
    tsa_status: "verified",
    tsa_attested_at: "2026-05-17T14:32:04Z",
    tsa_fallback_chain: '["dfn"]',
    bundle_dir: "/data/bundles/01ABCDEFGHJKMNPQRSTVWXYZ12",
  };
  const baseMeta = {
    id: baseEntry.id,
    original_filename: baseEntry.original_filename,
    mime_type: baseEntry.mime_type,
    size_bytes: baseEntry.size_bytes,
    sha256: baseEntry.sha256,
    server_timestamp: "2026-05-17T14:32:03Z",
    submitter_label: "Verkehrsunfall A100",
    source_ip: baseEntry.source_ip,
    tsa_provider: baseEntry.tsa_provider,
    tsa_status: baseEntry.tsa_status,
    tsa_attested_at: baseEntry.tsa_attested_at,
    tsa_fallback_chain: ["dfn"],
  };
  return {
    entry: { ...baseEntry, ...overrides } as ArchiveDetailViewModel["entry"],
    meta: { ...baseMeta, ...overrides } as ArchiveDetailViewModel["meta"],
  };
}

describe("renderArchiveDetailPage — structure & copy", () => {
  it("renders the page title with escaped filename", () => {
    const html = renderArchiveDetailPage(vm({ original_filename: "doc.pdf" }));
    expect(html).toContain("<title>doc.pdf — auto-archive</title>");
  });

  it("renders the back link to /archive", () => {
    const html = renderArchiveDetailPage(vm());
    expect(html).toMatch(/href="\/archive"[^>]*>← Zurück zum Archiv</);
  });

  it("renders the filename as h1", () => {
    const html = renderArchiveDetailPage(vm({ original_filename: "doc.pdf" }));
    expect(html).toMatch(/<h1 class="archive-detail__filename">doc\.pdf<\/h1>/);
  });

  it("renders all 9 metadata labels from UI-SPEC §Copywriting Contract", () => {
    const html = renderArchiveDetailPage(vm());
    for (const label of [
      "Archiv-ID",
      "Bezeichnung",
      "Dateigröße",
      "Dateityp",
      "SHA-256",
      "Server-Zeitstempel",
      "TSA-Zeitstempel",
      "TSA-Anbieter",
      "Quell-IP",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("renders Dateigröße via formatBytes (182,4 kB for 186777)", () => {
    const html = renderArchiveDetailPage(vm({ size_bytes: 186777 }));
    expect(html).toContain("182,4 kB");
  });

  it("renders truncated SHA-256 prefix + ellipsis in label and full hash in data-value", () => {
    const sha = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    const html = renderArchiveDetailPage(vm({ sha256: sha }));
    expect(html).toContain("b94d27b9934d3e08…");
    expect(html).toContain(`data-value="${sha}"`);
  });

  it("renders aria-live='polite' on the verify result region", () => {
    const html = renderArchiveDetailPage(vm());
    expect(html).toContain('aria-live="polite"');
  });

  it("references /static/archive-detail.js and /static/alpine.min.js", () => {
    const html = renderArchiveDetailPage(vm());
    expect(html).toContain("/static/archive-detail.js");
    expect(html).toContain("/static/alpine.min.js");
  });

  it("wires x-data verifyIntegrity with escaped archive id", () => {
    const html = renderArchiveDetailPage(vm());
    expect(html).toContain(
      `x-data="verifyIntegrity('01ABCDEFGHJKMNPQRSTVWXYZ12')"`,
    );
  });

  it("renders the Archiv-Bundle herunterladen button linking to /api/download/:id", () => {
    const html = renderArchiveDetailPage(vm());
    expect(html).toMatch(
      /<a class="btn btn--primary"[^>]*href="\/api\/download\/01ABCDEFGHJKMNPQRSTVWXYZ12"[^>]*>Archiv-Bundle herunterladen<\/a>/,
    );
  });
});

describe("renderArchiveDetailPage — empty label & tsa_attested_at fallback", () => {
  it("renders submitter_label='' as em-dash", () => {
    const html = renderArchiveDetailPage(vm({ submitter_label: "" }));
    // Bezeichnung row value should be the em-dash placeholder
    expect(html).toMatch(/Bezeichnung[\s\S]{0,200}—/);
  });

  it("renders '—' for TSA-Zeitstempel when entry.tsa_attested_at and meta.tsa_attested_at are both empty", () => {
    const html = renderArchiveDetailPage(
      vm({ tsa_attested_at: "" }),
    );
    expect(html).toMatch(/TSA-Zeitstempel[\s\S]{0,200}—/);
  });

  it("renders escaped tsa_attested_at when present", () => {
    const html = renderArchiveDetailPage(
      vm({ tsa_attested_at: "2026-05-17T14:32:03Z" }),
    );
    expect(html).toContain("2026-05-17T14:32:03Z");
  });
});

describe("renderArchiveDetailPage — XSS escape", () => {
  it("escapes malicious filename so no live <img> tag is emitted", () => {
    const evil = `<img onerror="alert(1)" src=x>`;
    const html = renderArchiveDetailPage(vm({ original_filename: evil }));
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).toContain("&lt;img");
  });
});

describe("W4 regression guard — obsolete field name absent from rendered HTML", () => {
  it("does NOT contain 'tsa_attested_time' anywhere in the output", () => {
    const html = renderArchiveDetailPage(vm());
    expect(html).not.toContain("tsa_attested_time");
  });
});

describe("renderNotFoundPage", () => {
  it("contains 'Eintrag nicht gefunden.' and a back link", () => {
    const html = renderNotFoundPage();
    expect(html).toContain("Eintrag nicht gefunden.");
    expect(html).toMatch(/href="\/archive"/);
    expect(html).toContain("<title>Nicht gefunden — auto-archive</title>");
  });
});

describe("renderErrorPage", () => {
  it("renders the given title in <title> and message in the body, with no <script> tags", () => {
    const html = renderErrorPage("Fehler", "Test message");
    expect(html).toContain("<title>Fehler — auto-archive</title>");
    expect(html).toContain("Test message");
    expect(html).not.toMatch(/<script\b/);
  });

  it("escapes HTML-special chars in title and message", () => {
    const html = renderErrorPage("<bad>", "<img onerror=x>");
    expect(html).not.toMatch(/<img onerror/);
    expect(html).toContain("&lt;img onerror=x&gt;");
  });
});
