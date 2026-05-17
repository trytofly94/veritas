/**
 * D-01: API key authentication middleware.
 * Uses crypto.timingSafeEqual to prevent timing-oracle attacks.
 * Returns 401 UNAUTHORIZED envelope for missing or wrong keys.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "./errorEnvelope.js";

/**
 * Build a Hono middleware that validates the `X-API-Key` request header
 * against `expected` using a constant-time comparison.
 *
 * - Pre-encodes `expected` once outside the closure (D-01).
 * - Length mismatch short-circuit prevents timingSafeEqual from throwing.
 * - Missing or wrong key → 401 with the D-23 German error envelope.
 */
export function apiKeyMiddleware(expected: string): MiddlewareHandler {
  // Pre-encode once; reused across all requests (no per-request allocation).
  const expectedBuf = Buffer.from(expected, "utf8");

  return async (c, next) => {
    const provided = c.req.header("x-api-key") ?? "";
    const providedBuf = Buffer.from(provided, "utf8");

    // timingSafeEqual requires equal-length buffers; length check must come first.
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return errorResponse(c, 401, "UNAUTHORIZED", "Nicht authentifiziert.");
    }

    await next();
  };
}
