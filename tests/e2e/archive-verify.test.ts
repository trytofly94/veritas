/**
 * E2e tests for POST /api/archive/:id/verify (Phase 3 — BROWSE-02).
 * Covers session-auth, ULID validation, success / hash_mismatch / file_missing
 * states, and the JSON envelope (NOT HTML — this is an API endpoint).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { openDb } from "../../src/db/client.js";
import { signSessionCookie } from "../../src/lib/sessionCookie.js";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

const TEST_API_KEY = "test-api-key-archive-verify-1234567890";
const TEST_ADMIN_PASSWORD = "test-pass-archive-verify";
const TEST_SESSION_SECRET =
  "test-session-secret-must-be-32-plus-bytes-long-yo";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let db: ReturnType<typeof openDb>;
let validCookie: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "auto-archive-verify-e2e-"),
  );

  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
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

  const now = Date.now();
  validCookie = signSessionCookie(
    { user: "admin", iat: now, exp: now + 3_600_000 },
    TEST_SESSION_SECRET,
  );
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await fsp.rm(dataDir, { recursive: true, force: true });
  delete process.env.API_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.MANIFEST_DB_PATH;
});

async function uploadFixture(filename: string, label: string): Promise<string> {
  const fileBuf = await fsp.readFile(FIXTURE);
  const form = new FormData();
  form.append("file", new Blob([fileBuf], { type: "text/plain" }), filename);
  form.append("label", label);
  const res = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    body: form,
    headers: { "X-API-Key": TEST_API_KEY },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe("POST /api/archive/:id/verify — auth + ULID validation", () => {
  it("returns 401 UNAUTHORIZED envelope without session cookie", async () => {
    const res = await fetch(
      `${baseUrl}/api/archive/01ZZZZZZZZZZZZZZZZZZZZZZZZ/verify`,
      { method: "POST" },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: boolean;
      code: string;
      message: string;
    };
    expect(body).toEqual({
      error: true,
      code: "UNAUTHORIZED",
      message: expect.any(String),
    });
  });

  it("returns 404 NOT_FOUND envelope on invalid ULID format", async () => {
    const res = await fetch(`${baseUrl}/api/archive/not-a-ulid/verify`, {
      method: "POST",
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: boolean; code: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 NOT_FOUND envelope on unknown but valid ULID", async () => {
    const res = await fetch(
      `${baseUrl}/api/archive/01ZZZZZZZZZZZZZZZZZZZZZZZZ/verify`,
      {
        method: "POST",
        headers: { Cookie: `session=${validCookie}` },
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: boolean; code: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("POST /api/archive/:id/verify — success + mismatch", () => {
  it("returns 200 {ok: true} on a fresh, unaltered upload", async () => {
    const id = await uploadFixture("ok.txt", "OK Bundle");
    const res = await fetch(`${baseUrl}/api/archive/${id}/verify`, {
      method: "POST",
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 200 {ok: false, reason: 'hash_mismatch'} after tampering", async () => {
    const id = await uploadFixture("tamper.txt", "Tampered");
    const bundleDir = path.join(dataDir, id);
    const originalPath = path.join(bundleDir, "original.txt");

    // Files are 444 + dir 555 — relax to allow rewrite.
    await fsp.chmod(bundleDir, 0o755);
    await fsp.chmod(originalPath, 0o644);
    await fsp.writeFile(originalPath, "tampered bytes — sha will differ");

    const res = await fetch(`${baseUrl}/api/archive/${id}/verify`, {
      method: "POST",
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("hash_mismatch");
  });
});
