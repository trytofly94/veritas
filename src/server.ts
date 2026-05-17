import { Hono } from "hono";
import { registerUpload } from "./routes/upload.js";
import { registerPages } from "./routes/pages.js";
import { registerLogin } from "./routes/login.js";
import { registerErrorEnvelope } from "./middleware/errorEnvelope.js";
import type { AppConfig } from "./lib/config.js";
import type { Db } from "./db/client.js";

export interface AppDeps {
  db: Db;
  config: AppConfig;
}

/**
 * Build the Hono application.
 *
 * Phase 2: takes a deps bag (db + config) so routes have access to DB and
 * configuration without reading process.env directly.
 *
 * Registration order:
 *  1. Global error envelope (D-23) — must come first to catch all handler errors.
 *  2. Health check — unchanged from Phase 1.
 *  3. Upload route with API key gate.
 *  4. Additional registrars (pages, login, download) — added by Plans 04 + 05.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // 1. Global error envelope — must come first (D-23)
  registerErrorEnvelope(app);

  // 2. Health check (unchanged)
  app.get("/health", (c) => c.json({ ok: true }));

  // 3. Pages route: GET / (upload form) + static asset serving (Plan 04)
  registerPages(app, deps);

  // 4. Login/logout routes: GET /login + POST /login + POST /logout (Plan 04)
  registerLogin(app, deps);

  // INSERTION POINT: Plan 05 adds registerDownload here.

  // 5. Upload route (with API key gate wired in Task 3 / Plan 03)
  registerUpload(app, deps);

  console.info("auto-archive ready (auth active)");
  return app;
}
