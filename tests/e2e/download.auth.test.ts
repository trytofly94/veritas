/**
 * E2e tests for GET /api/download/:id — auth/404/500 error matrix.
 * Cases: no auth, wrong key, unknown ULID, invalid ULID, missing bundle dir.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { openDb } from "../../src/db/client.js";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

const TEST_API_KEY = "test-api-key-download-auth-9876543210";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let db: ReturnType<typeof openDb>;

// A known-uploaded id for auth tests; a separate id for the missing-dir test
let knownId: string;
let missingDirId: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-dlauth-e2e-"));

  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";
  process.env.ADMIN_PASSWORD = "test-pass";
  process.env.MANIFEST_DB_PATH = path.join(dataDir, "manifest.sqlite");

  const config = loadConfig();
  db = openDb(config.manifestDbPath);
  const app = createApp({ db, config });

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });

  // Upload fixture for auth tests
  const fileBuf = await fsp.readFile(FIXTURE);

  {
    const form = new FormData();
    form.append("file", new Blob([fileBuf], { type: "text/plain" }), "hello.txt");
    form.append("label", "Auth Test");
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(201);
    knownId = ((await res.json()) as { id: string }).id;
  }

  // Upload a second fixture, then delete its bundle dir
  {
    const form = new FormData();
    form.append("file", new Blob([fileBuf], { type: "text/plain" }), "hello.txt");
    form.append("label", "Missing Dir Test");
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; bundle_path: string };
    missingDirId = body.id;
    // Remove the bundle directory to simulate row-without-disk failure
    await fsp.rm(body.bundle_path, { recursive: true, force: true });
  }
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await fsp.rm(dataDir, { recursive: true, force: true });
  delete process.env.API_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.MANIFEST_DB_PATH;
});

describe("GET /api/download/:id (auth + 404 matrix)", () => {
  it("returns 401 UNAUTHORIZED with no auth headers", async () => {
    const res = await fetch(`${baseUrl}/api/download/${knownId}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: boolean; code: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 UNAUTHORIZED with wrong X-API-Key (and no cookie)", async () => {
    const res = await fetch(`${baseUrl}/api/download/${knownId}`, {
      headers: { "X-API-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: boolean; code: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 NOT_FOUND for a well-formed but unknown ULID", async () => {
    const unknownUlid = "01J0000000000000000000ZZZZ";
    const res = await fetch(`${baseUrl}/api/download/${unknownUlid}`, {
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: boolean; code: string; message: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("Archiv nicht gefunden.");
  });

  it("returns 404 NOT_FOUND for a non-ULID id", async () => {
    const res = await fetch(`${baseUrl}/api/download/not-a-ulid`, {
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: boolean; code: string; message: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("Archiv nicht gefunden.");
  });

  it("returns 500 INTERNAL_ERROR when bundle dir is missing from disk (row exists in DB)", async () => {
    const res = await fetch(`${baseUrl}/api/download/${missingDirId}`, {
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: boolean; code: string; message: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("Unbekannter Fehler.");
  });
});
