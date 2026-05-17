import { describe, it, expect } from "vitest";
import { signSessionCookie, verifySessionCookie } from "../../src/lib/sessionCookie.js";
import * as fs from "node:fs";
import * as path from "node:path";

const SECRET = "super-secret-key-that-is-at-least-32-bytes-long!";
const NOW = Date.now();

describe("signSessionCookie / verifySessionCookie — D-02 session cookie security", () => {
  it("Test 1: round-trip — sign then verify returns same payload", () => {
    const payload = { user: "admin" as const, iat: NOW, exp: NOW + 3_600_000 };
    const cookie = signSessionCookie(payload, SECRET);
    const result = verifySessionCookie(cookie, SECRET);
    expect(result).not.toBeNull();
    expect(result!.user).toBe("admin");
    expect(result!.iat).toBe(NOW);
    expect(result!.exp).toBe(NOW + 3_600_000);
  });

  it("Test 2: tampered body returns null", () => {
    const payload = { user: "admin" as const, iat: NOW, exp: NOW + 3_600_000 };
    const cookie = signSessionCookie(payload, SECRET);
    // Flip one char in the body portion
    const parts = cookie.split(".");
    parts[0] = parts[0]!.slice(0, -1) + (parts[0]!.endsWith("a") ? "b" : "a");
    const tampered = parts.join(".");
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it("Test 3: tampered MAC returns null", () => {
    const payload = { user: "admin" as const, iat: NOW, exp: NOW + 3_600_000 };
    const cookie = signSessionCookie(payload, SECRET);
    const parts = cookie.split(".");
    // Flip one char in the MAC
    parts[1] = parts[1]!.slice(0, -1) + (parts[1]!.endsWith("a") ? "b" : "a");
    const tampered = parts.join(".");
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it("Test 4: expired payload (exp in the past) returns null", () => {
    const payload = { user: "admin" as const, iat: NOW - 10_000, exp: NOW - 1_000 };
    const cookie = signSessionCookie(payload, SECRET);
    expect(verifySessionCookie(cookie, SECRET)).toBeNull();
  });

  it("Test 5: missing dot separator returns null", () => {
    expect(verifySessionCookie("nodothere", SECRET)).toBeNull();
  });

  it("Test 6: different secret returns null", () => {
    const payload = { user: "admin" as const, iat: NOW, exp: NOW + 3_600_000 };
    const cookie = signSessionCookie(payload, SECRET);
    expect(verifySessionCookie(cookie, "different-secret-also-at-least-32-bytes!")).toBeNull();
  });

  it("Test 7: source code uses timingSafeEqual for MAC comparison (verified via source read)", () => {
    // This test enforces the security requirement by reading the source file
    // and asserting timingSafeEqual is present. Runtime behavior is tested above.
    const srcPath = path.resolve(process.cwd(), "src/lib/sessionCookie.ts");
    const src = fs.readFileSync(srcPath, "utf8");
    expect(src).toContain("timingSafeEqual");
  });
});
