/**
 * D-02: HMAC-SHA256 signed session cookie utility.
 * Cookie format: `${base64url(json)}.${base64url(hmacSha256)}`
 * Reject tampered/expired payloads via timing-safe compare.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
  user: "admin";
  iat: number;
  exp: number;
}

/**
 * Sign a session payload and return a signed cookie value.
 * Format: `base64url(json).base64url(hmac-sha256)`
 */
export function signSessionCookie(
  payload: SessionPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/**
 * Verify a signed session cookie. Returns the payload or null if invalid/expired/tampered.
 * Uses timing-safe MAC comparison to prevent timing attacks.
 */
export function verifySessionCookie(
  cookie: string,
  secret: string,
): SessionPayload | null {
  const dotIndex = cookie.indexOf(".");
  if (dotIndex === -1) return null;

  const body = cookie.slice(0, dotIndex);
  const mac = cookie.slice(dotIndex + 1);

  if (!body || !mac) return null;

  const expected = createHmac("sha256", secret).update(body).digest("base64url");

  // Must check lengths before timingSafeEqual — it throws on length mismatch
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (macBuf.length !== expectedBuf.length) return null;

  if (!timingSafeEqual(macBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    // Reject expired payloads
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
