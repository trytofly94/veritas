/**
 * D-12: Combined auth middleware — accepts EITHER a valid X-API-Key header
 * OR a valid HMAC-signed session cookie.
 * Neither → 401 UNAUTHORIZED envelope.
 */

import { timingSafeEqual } from "node:crypto";
import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { verifySessionCookie } from "../lib/sessionCookie.js";
import { errorResponse } from "./errorEnvelope.js";
import type { AppDeps } from "../server.js";

/**
 * Middleware that accepts either:
 *  - A valid X-API-Key header (timing-safe compare, D-01), OR
 *  - A valid HMAC-signed session cookie (D-02)
 *
 * Per D-12: "accepts either". If X-API-Key is wrong but cookie is valid,
 * the request is allowed (cookie fallback wins). Only when BOTH fail is 401
 * returned.
 */
export function authOrApiKey(deps: AppDeps): MiddlewareHandler {
  const expectedBuf = Buffer.from(deps.config.apiKey, "utf8");

  return async (c, next) => {
    // 1. Try API key
    const provided = c.req.header("x-api-key") ?? "";
    const providedBuf = Buffer.from(provided, "utf8");

    const apiKeyValid =
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf);

    if (apiKeyValid) {
      await next();
      return;
    }

    // 2. Fall back to session cookie
    const cookieValue = getCookie(c, "session") ?? "";
    const payload = verifySessionCookie(cookieValue, deps.config.sessionSecret);

    if (payload) {
      c.set("session" as never, payload);
      await next();
      return;
    }

    // 3. Neither passed
    return errorResponse(c, 401, "UNAUTHORIZED", "Nicht authentifiziert.");
  };
}
