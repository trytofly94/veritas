/**
 * Login and logout route registrar.
 *
 * D-03: timing-safe password comparison via crypto.timingSafeEqual
 * D-04: POST /login (form-encoded) — sets HMAC session cookie on success,
 *       redirects to /login?error=1 on failure
 * D-05: CSRF reliance on SameSite=Lax (no token needed in v1)
 * T-02-17: timingSafeEqual + length pre-check prevents timing oracle
 * T-02-21: isSafeNext() allowlist prevents open-redirect on ?next= param
 * T-02-22: POST /logout clears session cookie (Max-Age=0) — stateless HMAC
 *          so server-side revocation is deferred to v2
 * T-02-25: fresh cookie on every successful login (no session fixation)
 */

import type { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { signSessionCookie } from "../lib/sessionCookie.js";
import { renderLoginPage } from "../views/login.js";
import type { AppDeps } from "../server.js";

/**
 * Narrow allowlist for open-redirect protection (D-04, T-02-21).
 * A next-param is safe iff it:
 *  1. Is a string
 *  2. Starts with "/"
 *  3. Does NOT contain "//" (protocol-relative URL)
 *  4. Does NOT contain "\" (backslash-escaped paths)
 */
function isSafeNext(s: string | undefined): s is string {
  if (typeof s !== "string") return false;
  if (!s.startsWith("/")) return false;
  if (s.includes("//")) return false;
  if (s.includes("\\")) return false;
  return true;
}

export function registerLogin(app: Hono, deps: AppDeps): void {
  // GET /login — render login form (with optional error indicator)
  app.get("/login", (c) => {
    const error = c.req.query("error") === "1";
    return c.html(renderLoginPage({ error }));
  });

  // POST /login — form-encoded password validation
  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const password = String(body.password ?? "");
    const expected = deps.config.adminPassword;

    // D-03: timing-safe compare — pre-check lengths to avoid throwing
    const a = Buffer.from(password, "utf8");
    const b = Buffer.from(expected, "utf8");
    const ok = a.length === b.length && timingSafeEqual(a, b);

    if (!ok) {
      return c.redirect("/login?error=1", 303);
    }

    // T-02-25: sign a fresh cookie on every successful login
    const exp = Date.now() + 7 * 24 * 3600 * 1000;
    const cookie = signSessionCookie(
      { user: "admin", iat: Date.now(), exp },
      deps.config.sessionSecret,
    );

    c.header(
      "Set-Cookie",
      `session=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    );

    const next = c.req.query("next");
    return c.redirect(isSafeNext(next) ? next : "/", 303);
  });

  // POST /logout — clear session cookie (T-02-22)
  app.post("/logout", (c) => {
    c.header(
      "Set-Cookie",
      `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    );
    return c.redirect("/login", 303);
  });
}
