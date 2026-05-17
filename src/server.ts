import { Hono } from "hono";
import { registerUpload } from "./routes/upload.js";

let warned = false;

/**
 * Build the Hono application. The startup auth-warning is emitted exactly
 * once per process (regardless of how many app instances are constructed
 * in a test run) so noisy test logs stay readable.
 */
export function createApp(): Hono {
  if (!warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "⚠ Phase 1 has no auth — DO NOT expose port 3000 to the public internet",
    );
  }
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  registerUpload(app);
  return app;
}
