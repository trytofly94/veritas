import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

const TEST_API_KEY = "test-api-key-fallback-test-1234567890";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;

beforeAll(async () => {
  // Force DFN to be unreachable BEFORE the server boots.
  process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
  process.env.TSA_TIMEOUT_MS = "3000";
  delete process.env.TSA_FREETSA_ENDPOINT;
  delete process.env.TSA_DIGICERT_ENDPOINT;

  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "veritas-e2e-fallback-"));

  // Set auth env vars BEFORE calling loadConfig (D-06 fail-fast)
  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";
  process.env.ADMIN_PASSWORD = "test-pass";
  process.env.MANIFEST_DB_PATH = path.join(dataDir, "manifest.sqlite");

  // Fresh module load so the upload route picks the current env.
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
  delete process.env.TSA_DIGICERT_ENDPOINT;
  delete process.env.TSA_TIMEOUT_MS;
  delete process.env.API_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.MANIFEST_DB_PATH;
});

describe("POST /api/upload — DFN unreachable → falls back to FreeTSA", () => {
  it("records tsa_provider=freetsa and tsa_fallback_chain=['dfn','freetsa']", async () => {
    const fileBuf = await fsp.readFile(FIXTURE);
    const form = new FormData();
    form.append("file", new Blob([fileBuf], { type: "text/plain" }), "hello.txt");
    form.append("label", "fallback-test");

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; bundle_path: string };

    const meta = JSON.parse(
      await fsp.readFile(path.join(body.bundle_path, "metadata.json"), "utf8"),
    );
    expect(meta.tsa_provider).toBe("freetsa");
    expect(meta.tsa_fallback_chain).toEqual(["dfn", "freetsa"]);

    // tsa-cacert.pem MUST byte-equal the committed freetsa.pem (D-10).
    const bundledCa = await fsp.readFile(
      path.join(body.bundle_path, "tsa-cacert.pem"),
    );
    const repoCa = await fsp.readFile(
      path.resolve(process.cwd(), "assets/tsa-certs/freetsa.pem"),
    );
    expect(bundledCa.equals(repoCa)).toBe(true);

    // openssl ts -verify must pass with the bundled CA.
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
  }, 60_000);
});

describe("POST /api/upload — all TSAs unreachable → 502 + zero disk footprint (D-05)", () => {
  it("returns 502 TSA_UNAVAILABLE envelope and writes nothing to DATA_DIR", async () => {
    // Stop the existing server and bring up a fresh one with ALL three endpoints
    // blackholed. We do this by overriding ad-hoc with another DATA_DIR for
    // perfect isolation.
    const downDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "veritas-e2e-alldown-"),
    );
    try {
      const before = (await fsp.readdir(downDir)).filter(
        (e) => !e.startsWith("."),
      );
      expect(before).toEqual([]);

      // Snapshot env, override.
      const prev = {
        DATA_DIR: process.env.DATA_DIR,
        DFN: process.env.TSA_DFN_ENDPOINT,
        FREE: process.env.TSA_FREETSA_ENDPOINT,
        DIGI: process.env.TSA_DIGICERT_ENDPOINT,
        TIMEOUT: process.env.TSA_TIMEOUT_MS,
        MANIFEST_DB_PATH: process.env.MANIFEST_DB_PATH,
      };
      process.env.DATA_DIR = downDir;
      process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
      process.env.TSA_FREETSA_ENDPOINT = "http://127.0.0.1:1";
      process.env.TSA_DIGICERT_ENDPOINT = "http://127.0.0.1:1";
      process.env.TSA_TIMEOUT_MS = "1500";
      process.env.MANIFEST_DB_PATH = path.join(downDir, "manifest.sqlite");

      // Fresh server instance with the new env.
      const { createApp } = await import("../../src/server.js");
      const { loadConfig } = await import("../../src/lib/config.js");
      const { openDb } = await import("../../src/db/client.js");
      const config = loadConfig();
      const db = openDb(config.manifestDbPath);
      const app = createApp({ db, config });

      const downSrv = serve({ fetch: app.fetch, port: 0 });
      const port = await new Promise<number>((resolve) => {
        downSrv.on("listening", () => {
          const addr = downSrv.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      const downUrl = `http://127.0.0.1:${port}`;

      try {
        const fileBuf = await fsp.readFile(FIXTURE);
        const form = new FormData();
        form.append(
          "file",
          new Blob([fileBuf], { type: "text/plain" }),
          "hello.txt",
        );
        const res = await fetch(`${downUrl}/api/upload`, {
          method: "POST",
          body: form,
          headers: { "X-API-Key": TEST_API_KEY },
        });
        expect(res.status).toBe(502);
        // D-23 envelope: TSA_UNAVAILABLE (chain detail logged server-side only)
        const body = (await res.json()) as { error: boolean; code: string; message: string };
        expect(body.error).toBe(true);
        expect(body.code).toBe("TSA_UNAVAILABLE");
        expect(typeof body.message).toBe("string");

        // Filter out manifest DB files (manifest.sqlite, -shm, -wal) — these are
        // expected artifacts from Phase 2 DB setup. The key invariant is that
        // NO bundle directories were created (D-05 zero disk footprint for failed uploads).
        const after = (await fsp.readdir(downDir)).filter(
          (e) => !e.startsWith(".") && !e.startsWith("manifest.sqlite"),
        );
        expect(after).toEqual([]);
      } finally {
        await new Promise<void>((resolve, reject) =>
          downSrv.close((err) => (err ? reject(err) : resolve())),
        );
        // Restore env
        if (prev.DATA_DIR !== undefined) process.env.DATA_DIR = prev.DATA_DIR;
        if (prev.DFN !== undefined) process.env.TSA_DFN_ENDPOINT = prev.DFN;
        if (prev.FREE !== undefined)
          process.env.TSA_FREETSA_ENDPOINT = prev.FREE;
        else delete process.env.TSA_FREETSA_ENDPOINT;
        if (prev.DIGI !== undefined)
          process.env.TSA_DIGICERT_ENDPOINT = prev.DIGI;
        else delete process.env.TSA_DIGICERT_ENDPOINT;
        if (prev.TIMEOUT !== undefined)
          process.env.TSA_TIMEOUT_MS = prev.TIMEOUT;
        if (prev.MANIFEST_DB_PATH !== undefined)
          process.env.MANIFEST_DB_PATH = prev.MANIFEST_DB_PATH;
      }
    } finally {
      await fsp.rm(downDir, { recursive: true, force: true });
    }
    // Silence unused-import warning for fs in some toolchains
    void fs;
  }, 30_000);
});
