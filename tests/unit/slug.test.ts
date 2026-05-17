import { describe, it, expect } from "vitest";
import { slugifyLabel } from "../../src/lib/slug.js";

describe("slugifyLabel — D-13 slug algorithm", () => {
  it("Test 1: folds umlauts and lowercases words", () => {
    expect(slugifyLabel("Mietvertrag März 2026")).toBe("mietvertrag-maerz-2026");
  });

  it("Test 2: handles all uppercase German umlauts including ß", () => {
    expect(slugifyLabel("ÄÖÜß")).toBe("aeoeuess");
  });

  it("Test 3: empty string falls back to 'archive'", () => {
    expect(slugifyLabel("")).toBe("archive");
  });

  it("Test 4: whitespace-and-symbols-only falls back to 'archive'", () => {
    expect(slugifyLabel("   !!!   ")).toBe("archive");
  });

  it("Test 5: 100-char input is trimmed to ≤60 chars", () => {
    const input = "a".repeat(100);
    const result = slugifyLabel(input);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it("Test 6: leading/trailing dashes are stripped; internal sequences collapsed", () => {
    expect(slugifyLabel("---foo---bar---")).toBe("foo-bar");
  });

  it("Test 7: accented non-German chars produce only [a-z0-9-] in output", () => {
    const result = slugifyLabel("naïve café");
    // ï and é are not in the umlaut map so they map to '-' via the non-alphanum replace
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });
});
