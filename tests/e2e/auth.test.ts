/**
 * E2E tests for auth middleware (apiKeyMiddleware, requireSessionApi, authOrApiKey).
 * Covers D-01, D-02, D-23, D-24.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Must set env vars BEFORE importing server (loadConfig reads them at call time).
const TEST_API_KEY = "test-api-key-auth-test-xyz-12345678";
const TEST_SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";
const TEST_ADMIN_PASSWORD = "test-admin-password";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let dbPath: string;

// These are imported after env vars are set
let createApp: typeof import("../../src/server.js").createApp;
let loadConfig: typeof import("../../src/lib/config.js").loadConfig;
let openDb: typeof import("../../src/db/client.js").openDb;
let signSessionCookie: typeof import("../../src/lib/sessionCookie.js").signSessionCookie;
let requireSessionApi: typeof import("../../src/middleware/session.js").requireSessionApi;
let authOrApiKey: typeof import("../../src/middleware/authOrApiKey.js").authOrApiKey;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-e2e-auth-"));
  dbPath = path.join(dataDir, "manifest.sqlite");

  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
  process.env.MANIFEST_DB_PATH = dbPath;

  // Dynamic imports so env vars are set first
  const serverMod = await import("../../src/server.js");
  const configMod = await import("../../src/lib/config.js");
  const dbMod = await import("../../src/db/client.js");
  const cookieMod = await import("../../src/lib/sessionCookie.js");
  const sessionMod = await import("../../src/middleware/session.js");
  const authOrApiKeyMod = await import("../../src/middleware/authOrApiKey.js");

  createApp = serverMod.createApp;
  loadConfig = configMod.loadConfig;
  openDb = dbMod.openDb;
  signSessionCookie = cookieMod.signSessionCookie;
  requireSessionApi = sessionMod.requireSessionApi;
  authOrApiKey = authOrApiKeyMod.authOrApiKey;

  const config = loadConfig();
  const db = openDb(config.manifestDbPath);
  const app = createApp({ db, config });

  // Mount a session probe route for testing requireSessionApi in isolation
  app.get("/_session-probe", requireSessionApi({ db, config }), (c) =>
    c.json({ ok: true }),
  );

  // Mount an authOrApiKey probe route
  app.get("/_auth-probe", authOrApiKey({ db, config }), (c) =>
    c.json({ ok: true }),
  );

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await fsp.rm(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.API_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.MANIFEST_DB_PATH;
});

// ─── apiKeyMiddleware via POST /api/upload ────────────────────────────────────

describe("POST /api/upload — API key auth (D-01, D-23, D-24)", () => {
  it("returns 401 UNAUTHORIZED envelope when X-API-Key header is missing", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["hello"], { type: "text/plain" }),
      "test.txt",
    );

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: boolean;
      code: string;
      message: string;
    };
    expect(body.error).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("returns 401 UNAUTHORIZED envelope when X-API-Key is wrong", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["hello"], { type: "text/plain" }),
      "test.txt",
    );

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
      headers: { "X-API-Key": "wrong-key-value" },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: boolean;
      code: string;
      message: string;
    };
    expect(body.error).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(typeof body.message).toBe("string");
  });
});

// ─── requireSessionApi via /_session-probe ────────────────────────────────────

describe("GET /_session-probe — requireSessionApi middleware", () => {
  it("returns 401 when no Cookie header is present", async () => {
    const res = await fetch(`${baseUrl}/_session-probe`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: boolean; code: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when cookie is signed with wrong secret", async () => {
    const badCookie = signSessionCookie(
      { user: "admin", iat: Date.now(), exp: Date.now() + 3600_000 },
      "wrong-secret-that-is-not-the-real-one-xxxx",
    );
    const res = await fetch(`${baseUrl}/_session-probe`, {
      headers: { Cookie: `session=${badCookie}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: boolean; code: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when cookie body is tampered (flipped char)", async () => {
    const valid = signSessionCookie(
      { user: "admin", iat: Date.now(), exp: Date.now() + 3600_000 },
      TEST_SESSION_SECRET,
    );
    // Flip the first character of the body segment
    const tampered = valid.replace(/^./, (c) =>
      c === "a" ? "b" : "a",
    );
    const res = await fetch(`${baseUrl}/_session-probe`, {
      headers: { Cookie: `session=${tampered}` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when cookie is expired", async () => {
    const expiredCookie = signSessionCookie(
      { user: "admin", iat: Date.now() - 7200_000, exp: Date.now() - 3600_000 },
      TEST_SESSION_SECRET,
    );
    const res = await fetch(`${baseUrl}/_session-probe`, {
      headers: { Cookie: `session=${expiredCookie}` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 when cookie is valid and not expired", async () => {
    const validCookie = signSessionCookie(
      { user: "admin", iat: Date.now(), exp: Date.now() + 3600_000 },
      TEST_SESSION_SECRET,
    );
    const res = await fetch(`${baseUrl}/_session-probe`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// ─── authOrApiKey via /_auth-probe ───────────────────────────────────────────

describe("GET /_auth-probe — authOrApiKey middleware", () => {
  it("allows request with valid X-API-Key (no cookie)", async () => {
    const res = await fetch(`${baseUrl}/_auth-probe`, {
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(res.status).toBe(200);
  });

  it("allows request with valid session cookie (no X-API-Key)", async () => {
    const validCookie = signSessionCookie(
      { user: "admin", iat: Date.now(), exp: Date.now() + 3600_000 },
      TEST_SESSION_SECRET,
    );
    const res = await fetch(`${baseUrl}/_auth-probe`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 when neither API key nor cookie is provided", async () => {
    const res = await fetch(`${baseUrl}/_auth-probe`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: boolean; code: string };
    expect(body.error).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("allows request when API key is wrong but valid session cookie is present", async () => {
    const validCookie = signSessionCookie(
      { user: "admin", iat: Date.now(), exp: Date.now() + 3600_000 },
      TEST_SESSION_SECRET,
    );
    const res = await fetch(`${baseUrl}/_auth-probe`, {
      headers: {
        "X-API-Key": "wrong-key",
        Cookie: `session=${validCookie}`,
      },
    });
    // D-12: cookie fallback wins; absence of valid API key is not failure if cookie is valid
    expect(res.status).toBe(200);
  });
});
