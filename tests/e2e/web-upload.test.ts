/**
 * E2e tests for the web upload surface:
 *  - GET / (upload form page)
 *  - GET /static/* (static asset serving)
 *  - Round-trip: extract API key from rendered page → POST /api/upload
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { openDb } from "../../src/db/client.js";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const TEST_API_KEY = "test-api-key-web-upload-1234567890";
const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-web-upload-e2e-"));

  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";
  process.env.ADMIN_PASSWORD = "test-pass-1234";
  process.env.MANIFEST_DB_PATH = path.join(dataDir, "manifest.sqlite");

  const config = loadConfig();
  const db = openDb(config.manifestDbPath);
  const app = createApp({ db, config });

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

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

describe("GET /", () => {
  it("returns 200 text/html with 'Datei archivieren' and script tag for upload.js", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.toLowerCase()).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Datei archivieren");
    expect(body).toContain('<script defer src="/static/upload.js">');
  });

  it("embeds the API_KEY in the x-data attribute", async () => {
    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();
    // The page renders: x-data="uploadForm("test-api-key-web-upload-1234567890")"
    const match = body.match(/x-data="uploadForm\(([^)]+)\)"/);
    expect(match).toBeTruthy();
    const injectedKey = JSON.parse(match![1]);
    expect(injectedKey).toBe(TEST_API_KEY);
  });
});

describe("GET /static/*", () => {
  it("GET /static/style.css returns 200 with CSS content-type", async () => {
    const res = await fetch(`${baseUrl}/static/style.css`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.toLowerCase()).toContain("css");
  });

  it("GET /static/alpine.min.js returns 200 with JavaScript content-type", async () => {
    const res = await fetch(`${baseUrl}/static/alpine.min.js`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.toLowerCase()).toContain("javascript");
  });

  it("GET /static/upload.js returns 200 and body contains XMLHttpRequest", async () => {
    const res = await fetch(`${baseUrl}/static/upload.js`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("XMLHttpRequest");
  });
});

describe("Round-trip: page API key → /api/upload", () => {
  it("extracts API key from rendered page and uploads successfully (D-11 proof)", async () => {
    // 1. GET / and extract the injected API key from the x-data attribute
    const pageRes = await fetch(`${baseUrl}/`);
    const pageBody = await pageRes.text();
    const match = pageBody.match(/x-data="uploadForm\(([^)]+)\)"/);
    expect(match).toBeTruthy();
    const extractedKey = JSON.parse(match![1]);
    expect(extractedKey).toBe(TEST_API_KEY);

    // 2. Use the extracted key to POST to /api/upload
    const fileBuf = await fsp.readFile(FIXTURE);
    const form = new FormData();
    form.append("file", new Blob([fileBuf], { type: "text/plain" }), "hello.txt");
    form.append("label", "web-upload-roundtrip");

    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
      headers: { "X-API-Key": extractedKey },
    });

    expect(uploadRes.status).toBe(201);
    const body = await uploadRes.json() as { id: string; bundle_path: string };
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  }, 60_000);
});
