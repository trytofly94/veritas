import { describe, it, expect } from "vitest";
import { renderVerifyMd } from "../../src/lib/verifyTemplate.js";
import type { Metadata } from "../../src/types.js";

// Fixture that covers all five substitution tokens
const FIXTURE: Metadata = {
  id: "01JWMZ1234ABCDEFGHIJKLMNOP",
  original_filename: "contract.pdf",
  mime_type: "application/pdf",
  size_bytes: 102400,
  sha256: "abc123def456abc123def456abc123def456abc123def456abc123def456abc12",
  created_at: "2026-05-17T12:00:00Z",
  label: "Mietvertrag",
  source_ip: "127.0.0.1",
  tsa_provider: "dfn",
  tsa_status: "verified",
  tsa_attested_at: "2026-05-17T12:00:00Z",
  tsa_fallback_chain: ["dfn"],
};

describe("renderVerifyMd — D-16/D-17 VERIFY.md template rendering", () => {
  it("Test 1: output contains all five token values and the load-bearing legal sentence", () => {
    const out = renderVerifyMd(FIXTURE);

    // All five tokens substituted with actual values
    expect(out).toContain("01JWMZ1234ABCDEFGHIJKLMNOP");
    expect(out).toContain("contract.pdf");
    expect(out).toContain("abc123def456abc123def456abc123def456abc123def456abc123def456abc12");
    expect(out).toContain("dfn");
    expect(out).toContain("2026-05-17T12:00:00Z");

    // Load-bearing legal sentence (D-16 + CONTEXT <specifics>)
    expect(out).toContain(
      "Diese Datei beweist, dass die Originaldatei zum angegebenen Zeitpunkt unverändert existiert hat",
    );

    // All four section headings from D-16
    expect(out).toContain("## Was ist das?");
    expect(out).toContain("## Wie prüfen");
    expect(out).toContain("## Rechtlicher Rahmen");
    expect(out).toContain("## TSA-Vertrauensquelle");
  });

  it("Test 2: output contains § 286 ZPO (LEGAL-01 legal framing)", () => {
    const out = renderVerifyMd(FIXTURE);
    expect(out).toContain("§ 286 ZPO");
  });

  it("Test 3: output mentions RFC 3161 and eIDAS (D-16 technical framing)", () => {
    const out = renderVerifyMd(FIXTURE);
    expect(out).toContain("RFC 3161");
    expect(out).toContain("eIDAS");
  });

  it("Test 4: no unsubstituted {{ }} tokens remain in output", () => {
    const out = renderVerifyMd(FIXTURE);
    expect(out).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
