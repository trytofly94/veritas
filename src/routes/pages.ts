/**
 * Pages route registrar — GET / and static asset serving.
 *
 * D-11 TRADE-OFF (locked from CONTEXT.md):
 *   `/` is NOT session-gated in v1. The API key is injected into the rendered
 *   HTML so the Alpine XHR component can POST directly to /api/upload without
 *   an extra round-trip. This is acceptable because `/` sits behind Cloudflare
 *   Tunnel + Caddy on a family-shared deployment.
 *
 *   If this assumption ever changes (e.g., `/` becomes publicly accessible):
 *   1. Add `requireSessionPage(deps)` middleware to the GET "/" route.
 *   2. Remove the apiKey injection from renderUploadPage.
 *   3. Add `GET /api/me/upload-token` (session-gated) that returns the key.
 *   4. Alpine fetches the token via XHR before the first upload.
 *   See CONTEXT.md D-11 fallback note for the full migration path.
 *
 * D-07: Alpine.js and other static assets are vendored locally under
 *   src/static/ — no CDN references appear in the rendered HTML.
 *
 * T-02-24: Hono's serveStatic restricts file reads to the configured root;
 *   relative-path inputs cannot escape via "../" because serveStatic resolves
 *   and rejects out-of-root paths.
 */

import type { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { renderUploadPage } from "../views/upload.js";
import type { AppDeps } from "../server.js";

export function registerPages(app: Hono, deps: AppDeps): void {
  // GET / — upload form (D-11: API key injected, no session gate in v1)
  app.get("/", (c) => c.html(renderUploadPage({ apiKey: deps.config.apiKey })));

  // Static asset serving for /static/* (D-07: vendored Alpine + CSS + upload.js)
  // root is relative to process.cwd(); rewriteRequestPath strips /static prefix
  // so Hono looks up files at ./src/static/<filename>.
  app.use(
    "/static/*",
    serveStatic({
      root: "./",
      rewriteRequestPath: (p) => p.replace(/^\/static/, "/src/static"),
    }),
  );
}
