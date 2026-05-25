import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

const TEST_API_KEY = "test-api-key-digicert-test-1234567890";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let digicertReachable = true;

beforeAll(async () => {
  // Probe DigiCert reachability — gate the test only on CI / locked-down
  // hosts (the dev machine MUST reach it per CONCERN-6).
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5_000);
    const probe = await fetch("http://timestamp.digicert.com", {
      method: "HEAD",
      signal: ac.signal,
    }).catch(() => null);
    clearTimeout(timer);
    digicertReachable = probe !== null;
  } catch {
    digicertReachable = false;
  }

  // Block DFN AND FreeTSA so the chain MUST reach DigiCert.
  process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
  process.env.TSA_FREETSA_ENDPOINT = "http://127.0.0.1:1";
  delete process.env.TSA_DIGICERT_ENDPOINT; // allow real
  process.env.TSA_TIMEOUT_MS = "3000";

  dataDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "veritas-e2e-digicert-"),
  );

  // Set auth env vars BEFORE calling loadConfig (D-06 fail-fast)
  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";
  process.env.ADMIN_PASSWORD = "test-pass";
  process.env.MANIFEST_DB_PATH = path.join(dataDir, "manifest.sqlite");

  const { createApp } = await import("../../src/server.js");
  const { loadConfig } = await import("../../src/lib/config.js");
  const { openDb } = await import("../../src/db/client.js");
  const config = loadConfig();
  const db = openDb(config.manifestDbPath);
  const app = createApp({ db, config });

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await fsp.rm(dataDir, { recursive: true, force: true });
  delete process.env.TSA_DFN_ENDPOINT;
  delete process.env.TSA_FREETSA_ENDPOINT;
  delete process.env.TSA_TIMEOUT_MS;
  delete process.env.API_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.MANIFEST_DB_PATH;
});

describe("POST /api/upload — DFN + FreeTSA down → succeeds against real DigiCert (CONCERN-6)", () => {
  it.skipIf(!digicertReachable)(
    "records tsa_provider=digicert with full fallback chain and verifies offline",
    async () => {
      const fileBuf = await fsp.readFile(FIXTURE);
      const form = new FormData();
      form.append(
        "file",
        new Blob([fileBuf], { type: "text/plain" }),
        "hello.txt",
      );
      form.append("label", "digicert-success-test");

      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        body: form,
        headers: { "X-API-Key": TEST_API_KEY },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; bundle_path: string };

      const meta = JSON.parse(
        await fsp.readFile(
          path.join(body.bundle_path, "metadata.json"),
          "utf8",
        ),
      );
      expect(meta.tsa_provider).toBe("digicert");
      expect(meta.tsa_fallback_chain).toEqual([
        "dfn",
        "freetsa",
        "digicert",
      ]);

      // tsa-cacert.pem must byte-equal committed digicert.pem
      const bundledCa = await fsp.readFile(
        path.join(body.bundle_path, "tsa-cacert.pem"),
      );
      const repoCa = await fsp.readFile(
        path.resolve(process.cwd(), "assets/tsa-certs/digicert.pem"),
      );
      expect(bundledCa.equals(repoCa)).toBe(true);

      // openssl ts -verify must exit 0 against the bundled CA.
      execFileSync(
        "openssl",
        [
          "ts",
          "-verify",
          "-in",
          path.join(body.bundle_path, "original.tsr"),
          "-data",
          path.join(body.bundle_path, "original.txt"),
          "-CAfile",
          path.join(body.bundle_path, "tsa-cacert.pem"),
        ],
        { stdio: "pipe" },
      );
    },
    60_000,
  );
});
