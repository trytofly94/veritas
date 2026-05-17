/**
 * Phase 3 Plan 01 — Pure formatters + archive list view unit tests.
 *
 * Covers:
 *  - formatRowDate: ISO → "YYYY-MM-DD HH:mm" (UTC), invalid → "—"
 *  - mimeToType: MIME → uppercase subtype, text/plain → "TXT", empty/null → "—"
 *  - tsaBadgeProps: provider+status → { className, label } mapping per UI-SPEC
 *  - renderArchiveListPage: empty + populated + XSS escape + title attr + no row JS
 */

import { describe, it, expect } from "vitest";
import {
  formatRowDate,
  mimeToType,
  tsaBadgeProps,
} from "../../src/lib/formatList.js";
import {
  renderArchiveListPage,
  type ArchiveListEntry,
} from "../../src/views/archive-list.js";

describe("formatRowDate", () => {
  it("formats a valid ISO string as YYYY-MM-DD HH:mm (UTC)", () => {
    expect(formatRowDate("2026-05-17T14:32:01Z")).toBe("2026-05-17 14:32");
  });

  it("returns '—' for an invalid date string", () => {
    expect(formatRowDate("not-a-date")).toBe("—");
  });

  it("returns '—' for an empty string", () => {
    expect(formatRowDate("")).toBe("—");
  });
});

describe("mimeToType", () => {
  it("application/pdf → PDF", () => {
    expect(mimeToType("application/pdf")).toBe("PDF");
  });

  it("image/jpeg → JPEG", () => {
    expect(mimeToType("image/jpeg")).toBe("JPEG");
  });

  it("text/plain → TXT (special case)", () => {
    expect(mimeToType("text/plain")).toBe("TXT");
  });

  it("application/zip → ZIP", () => {
    expect(mimeToType("application/zip")).toBe("ZIP");
  });

  it("empty string → —", () => {
    expect(mimeToType("")).toBe("—");
  });

  it("null → —", () => {
    expect(mimeToType(null)).toBe("—");
  });

  it("undefined → —", () => {
    expect(mimeToType(undefined)).toBe("—");
  });
});

describe("tsaBadgeProps", () => {
  it("dfn + ok → tsa-badge--ok / DFN", () => {
    expect(tsaBadgeProps("dfn", "ok")).toEqual({
      className: "tsa-badge tsa-badge--ok",
      label: "DFN",
    });
  });

  it("freetsa + ok → tsa-badge--ok / FreeTSA", () => {
    expect(tsaBadgeProps("freetsa", "ok")).toEqual({
      className: "tsa-badge tsa-badge--ok",
      label: "FreeTSA",
    });
  });

  it("local-fallback + ok → tsa-badge--local / Lokal", () => {
    expect(tsaBadgeProps("local-fallback", "ok")).toEqual({
      className: "tsa-badge tsa-badge--local",
      label: "Lokal",
    });
  });

  it("dfn + failed → tsa-badge--failed / Fehlgeschlagen", () => {
    expect(tsaBadgeProps("dfn", "failed")).toEqual({
      className: "tsa-badge tsa-badge--failed",
      label: "Fehlgeschlagen",
    });
  });

  it("digicert + ok → tsa-badge--ok / Digicert (capitalized)", () => {
    expect(tsaBadgeProps("digicert", "ok")).toEqual({
      className: "tsa-badge tsa-badge--ok",
      label: "Digicert",
    });
  });

  it("unknown status (not ok/verified, not failed) → failed badge", () => {
    expect(tsaBadgeProps("dfn", "weird-status")).toEqual({
      className: "tsa-badge tsa-badge--failed",
      label: "Fehlgeschlagen",
    });
  });

  it("treats 'verified' status the same as 'ok' (Phase 2 manifest uses 'verified')", () => {
    expect(tsaBadgeProps("dfn", "verified")).toEqual({
      className: "tsa-badge tsa-badge--ok",
      label: "DFN",
    });
  });
});

describe("renderArchiveListPage — empty state", () => {
  it("contains 'Noch keine Dateien archiviert.' copy", () => {
    const html = renderArchiveListPage({ entries: [] });
    expect(html).toContain("Noch keine Dateien archiviert.");
  });

  it("contains the 'Datei hochladen' CTA linking to /", () => {
    const html = renderArchiveListPage({ entries: [] });
    expect(html).toMatch(/href="\/"[^>]*>\s*Datei hochladen/);
  });
});

describe("renderArchiveListPage — populated state", () => {
  const entry: ArchiveListEntry = {
    id: "01ABCDEFGHJKMNPQRSTVWXYZ12",
    original_filename: "contract.pdf",
    created_at: "2026-05-17T14:32:01Z",
    mime_type: "application/pdf",
    tsa_provider: "dfn",
    tsa_status: "ok",
  };

  it("renders a single <tr> with the filename + formatted date + type + badge", () => {
    const html = renderArchiveListPage({ entries: [entry] });
    expect(html).toContain("contract.pdf");
    expect(html).toContain("2026-05-17 14:32");
    expect(html).toContain(">PDF<");
    expect(html).toContain("tsa-badge--ok");
    expect(html).toContain(">DFN<");
  });

  it("filename cell <a> has href=/archive/{id} AND title attribute with full filename", () => {
    const html = renderArchiveListPage({ entries: [entry] });
    expect(html).toMatch(
      /<a\s+href="\/archive\/01ABCDEFGHJKMNPQRSTVWXYZ12"\s+title="contract\.pdf">contract\.pdf<\/a>/,
    );
  });

  it("contains no row-level onclick attribute", () => {
    const html = renderArchiveListPage({ entries: [entry] });
    expect(html).not.toContain("onclick");
  });

  it("contains no row-level onkeydown attribute", () => {
    const html = renderArchiveListPage({ entries: [entry] });
    expect(html).not.toContain("onkeydown");
  });

  it("contains all four required column headers", () => {
    const html = renderArchiveListPage({ entries: [entry] });
    expect(html).toContain("Dateiname");
    expect(html).toContain("Datum");
    expect(html).toContain("Typ");
    expect(html).toContain("Status");
  });
});

describe("renderArchiveListPage — XSS escaping", () => {
  it("escapes <script> in filename in both text and title attribute contexts", () => {
    const entry: ArchiveListEntry = {
      id: "01ABCDEFGHJKMNPQRSTVWXYZ12",
      original_filename: "<script>evil</script>.pdf",
      created_at: "2026-05-17T14:32:01Z",
      mime_type: "application/pdf",
      tsa_provider: "dfn",
      tsa_status: "ok",
    };
    const html = renderArchiveListPage({ entries: [entry] });
    // No live <script> tag should appear in the rendered body
    expect(html).not.toContain("<script>evil</script>");
    // Encoded version should be present
    expect(html).toContain("&lt;script&gt;evil&lt;/script&gt;.pdf");
  });

  it("escapes double quotes inside title attribute value", () => {
    const entry: ArchiveListEntry = {
      id: "01ABCDEFGHJKMNPQRSTVWXYZ12",
      original_filename: 'evil".pdf',
      created_at: "2026-05-17T14:32:01Z",
      mime_type: "application/pdf",
      tsa_provider: "dfn",
      tsa_status: "ok",
    };
    const html = renderArchiveListPage({ entries: [entry] });
    // Raw double quote must NOT appear inside the title=... attribute value;
    // it must be encoded as &quot; so the attribute boundary is preserved.
    expect(html).toContain('title="evil&quot;.pdf"');
    expect(html).not.toContain('title="evil".pdf"');
  });
});
