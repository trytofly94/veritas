import { serve } from "@hono/node-server";
import { createApp } from "./server.js";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`auto-archive listening on http://0.0.0.0:${info.port}`);
});
