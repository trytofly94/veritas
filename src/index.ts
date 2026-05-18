import { serve } from "@hono/node-server";
import { createApp } from "./server.js";
import { loadConfig } from "./lib/config.js";
import { openDb } from "./db/client.js";
import { backfillManifest } from "./db/backfill.js";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  console.error("[startup]", (err as Error).message);
  process.exit(1);
}

const db = openDb(config.manifestDbPath);
await backfillManifest({ db, dataDir: config.dataDir });

const app = createApp({ db, config });
const port = Number(process.env.PORT ?? 3700);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`auto-archive listening on http://0.0.0.0:${info.port}`);
});
