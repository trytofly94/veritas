/**
 * D-02: Session cookie authentication middlewares.
 * Two variants: API (401 envelope) and page (303 redirect) — D-04.
 */

import { getCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { verifySessionCookie } from "../lib/sessionCookie.js";
import { errorResponse } from "./errorEnvelope.js";
import type { AppDeps } from "../server.js";

/**
 * API middleware — requires a valid HMAC-signed session cookie.
 * Missing or invalid cookie → 401 UNAUTHORIZED envelope (D-23).
 * Valid cookie → stores payload on `c.var.session` and calls next().
 */
export function requireSessionApi(deps: AppDeps): MiddlewareHandler {
  return async (c, next) => {
    const cookieValue = getCookie(c, "session") ?? "";
    const payload = verifySessionCookie(cookieValue, deps.config.sessionSecret);

    if (!payload) {
      return errorResponse(c, 401, "UNAUTHORIZED", "Nicht authentifiziert.");
    }

    // Store session payload for downstream handlers
    c.set("session" as never, payload);
    await next();
  };
}

/**
 * Page middleware — requires a valid HMAC-signed session cookie.
 * Missing or invalid cookie → 303 redirect to /login?next=<url-encoded-path>.
 * Valid cookie → calls next().
 */
export function requireSessionPage(deps: AppDeps): MiddlewareHandler {
  return async (c, next) => {
    const cookieValue = getCookie(c, "session") ?? "";
    const payload = verifySessionCookie(cookieValue, deps.config.sessionSecret);

    if (!payload) {
      return c.redirect(
        "/login?next=" + encodeURIComponent(c.req.path),
        303,
      );
    }

    c.set("session" as never, payload);
    await next();
  };
}
