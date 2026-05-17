/**
 * E2e tests for GET /api/download/:id — happy path + session cookie path.
 * Tests: status 200, headers, ZIP contents (8 entries), VERIFY.md content.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { openDb } from "../../src/db/client.js";
import { signSessionCookie } from "../../src/lib/sessionCookie.js";
import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

const TEST_API_KEY = "test-api-key-download-happy-1234567890";
const SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let db: ReturnType<typeof openDb>;

// Uploaded once in beforeAll; shared across all tests in this file
let sharedId: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-dl-e2e-"));

  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = SESSION_SECRET;
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

  // Upload the fixture once so all tests share the same archive entry
  const fileBuf = await fsp.readFile(FIXTURE);
  const form = new FormData();
  form.append("file", new Blob([fileBuf], { type: "text/plain" }), "hello.txt");
  form.append("label", "Test Bundle");

  const res = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    body: form,
    headers: { "X-API-Key": TEST_API_KEY },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  sharedId = body.id;
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

describe("GET /api/download/:id (happy path + session cookie)", () => {
  it("returns 200 with correct headers and a ZIP containing exactly 8 entries (API key auth)", async () => {
    const res = await fetch(`${baseUrl}/api/download/${sharedId}`, {
      headers: { "X-API-Key": TEST_API_KEY },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const disposition = res.headers.get("content-disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(`filename="test-bundle-${sharedId}.zip"`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // D-15: Content-Length must be absent (streaming)
    expect(res.headers.get("content-length")).toBeNull();

    // Save to temp file and verify ZIP contents with unzip
    const tmpZip = path.join(dataDir, `${sharedId}.zip`);
    const buf = await res.arrayBuffer();
    await fsp.writeFile(tmpZip, Buffer.from(buf));

    const listing = execFileSync("unzip", ["-l", tmpZip], {
      encoding: "utf8",
    });

    // D-14: exactly 8 entries
    const EXPECTED_ENTRIES = [
      "original.txt",
      "original.sha256",
      "original.tsq",
      "original.tsr",
      "tsa-cacert.pem",
      "metadata.json",
      "verify.sh",
      "VERIFY.md",
    ];
    for (const entry of EXPECTED_ENTRIES) {
      expect(listing).toContain(entry);
    }

    // Count the actual file entries (lines with a file size at the start).
    // unzip -l format varies by platform:
    //   macOS: "     SIZE  MM-DD-YYYY HH:MM   filename"
    //   Linux: "     SIZE  YYYY-MM-DD HH:MM   filename"
    // Match any line that starts with whitespace + digits + whitespace + date-like pattern.
    const fileLines = listing
      .split("\n")
      .filter((l) => /^\s+\d+\s+\d{2}[-/]\d{2}[-/]\d{2,4}/.test(l));
    expect(fileLines).toHaveLength(8);
  }, 30_000);

  it("returns 200 when authenticated via session cookie (no X-API-Key)", async () => {
    const now = Date.now();
    const payload = {
      user: "admin" as const,
      iat: now,
      exp: now + 3600_000, // 1 hour
    };
    const cookieValue = signSessionCookie(payload, SESSION_SECRET);

    const res = await fetch(`${baseUrl}/api/download/${sharedId}`, {
      headers: { Cookie: `session=${cookieValue}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
  }, 30_000);

  it("VERIFY.md inside ZIP contains id, sha256, § 286 ZPO, and 'Diese Datei beweist'", async () => {
    const res = await fetch(`${baseUrl}/api/download/${sharedId}`, {
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(200);

    const tmpZip = path.join(dataDir, `verify-check-${sharedId}.zip`);
    const buf = await res.arrayBuffer();
    await fsp.writeFile(tmpZip, Buffer.from(buf));

    // Extract VERIFY.md only
    const tmpExtractDir = path.join(dataDir, `extract-${sharedId}`);
    await fsp.mkdir(tmpExtractDir, { recursive: true });
    execFileSync("unzip", ["-o", tmpZip, "VERIFY.md", "-d", tmpExtractDir], {
      stdio: "pipe",
    });

    const verifyMd = await fsp.readFile(
      path.join(tmpExtractDir, "VERIFY.md"),
      "utf8"
    );

    expect(verifyMd).toContain(sharedId);
    expect(verifyMd).toContain("§ 286 ZPO");
    expect(verifyMd).toContain("Diese Datei beweist");
    // sha256 from the metadata should appear in VERIFY.md
    expect(verifyMd).toMatch(/[0-9a-f]{64}/);
  }, 30_000);
});
