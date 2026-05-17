/**
 * Unit tests for src/lib/formatDetail.ts (Phase 3 — BROWSE-02).
 *
 * Covers:
 *   - formatBytes (German locale decimal comma, B/kB/MB/GB/TB ladder, base 1000)
 *   - truncateSha (16-char prefix + ellipsis, empty placeholder, short input)
 */

import { describe, it, expect } from "vitest";
import { formatBytes, truncateSha } from "../../src/lib/formatDetail.js";

describe("formatBytes", () => {
  it("returns '0 B' for 0", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("returns '1023 B' for 1023 (still under 1 kB)", () => {
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("returns '1,0 kB' for 1024 (German decimal comma, base 1000 ladder)", () => {
    // 1024 / 1000 = 1.024 → rounded to 1 decimal = 1,0 kB
    expect(formatBytes(1024)).toBe("1,0 kB");
  });

  it("returns '182,4 kB' for 186777 (UI-SPEC example value)", () => {
    expect(formatBytes(186777)).toBe("182,4 kB");
  });

  it("returns '2,1 MB' for 2_200_000", () => {
    expect(formatBytes(2_200_000)).toBe("2,1 MB");
  });

  it("returns '4,7 GB' for 5_000_000_000", () => {
    expect(formatBytes(5_000_000_000)).toBe("4,7 GB");
  });
});

describe("truncateSha", () => {
  it("truncates 64-char hash to 16 chars + ellipsis", () => {
    expect(truncateSha("a".repeat(64))).toBe("aaaaaaaaaaaaaaaa…");
  });

  it("returns em-dash for empty string", () => {
    expect(truncateSha("")).toBe("—");
  });

  it("returns short input unchanged when under 16 chars", () => {
    expect(truncateSha("short")).toBe("short");
  });
});
