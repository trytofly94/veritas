/**
 * E2e tests for login / logout routes.
 * Tests the full flow: GET /login, POST /login (success + failure), POST /logout.
 *
 * Uses Node's fetch with redirect:"manual" so we can inspect Location and Set-Cookie
 * headers without auto-following redirects.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { openDb } from "../../src/db/client.js";
import { verifySessionCookie } from "../../src/lib/sessionCookie.js";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const TEST_API_KEY = "test-api-key-login-test-1234567890";
const TEST_ADMIN_PASSWORD = "test-pass-1234";
const TEST_SESSION_SECRET = "test-session-secret-must-be-32-plus-bytes-long-yo";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-login-e2e-"));

  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = TEST_API_KEY;
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
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

describe("GET /login", () => {
  it("returns 200 with login form HTML", async () => {
    const res = await fetch(`${baseUrl}/login`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Anmelden");
    expect(body).toContain("Passwort");
  });

  it("GET /login?error=1 includes 'Falsches Passwort.'", async () => {
    const res = await fetch(`${baseUrl}/login?error=1`, { redirect: "manual" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Falsches Passwort.");
  });
});

describe("POST /login — success", () => {
  it("303 redirect to / with session cookie (HttpOnly; Secure; SameSite=Lax; Path=/)", async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(TEST_ADMIN_PASSWORD)}`,
      redirect: "manual",
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
  });

  it("cookie value is verifiable by verifySessionCookie", async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(TEST_ADMIN_PASSWORD)}`,
      redirect: "manual",
    });

    const setCookie = res.headers.get("set-cookie") ?? "";
    // Extract the session value: session=<value>;
    const match = setCookie.match(/session=([^;]+)/);
    expect(match).toBeTruthy();
    const cookieValue = match![1];

    const payload = verifySessionCookie(cookieValue, TEST_SESSION_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.user).toBe("admin");
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it("safe ?next= param is honored", async () => {
    const res = await fetch(`${baseUrl}/login?next=/foo/bar`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(TEST_ADMIN_PASSWORD)}`,
      redirect: "manual",
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/foo/bar");
  });

  it("unsafe ?next=//evil.example is rejected → redirect to /", async () => {
    const res = await fetch(`${baseUrl}/login?next=${encodeURIComponent("//evil.example")}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(TEST_ADMIN_PASSWORD)}`,
      redirect: "manual",
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  it("unsafe ?next=https://evil.example is rejected → redirect to /", async () => {
    const res = await fetch(`${baseUrl}/login?next=${encodeURIComponent("https://evil.example")}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(TEST_ADMIN_PASSWORD)}`,
      redirect: "manual",
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("POST /login — failure", () => {
  it("wrong password → 303 to /login?error=1, no session cookie", async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=wrongpassword",
      redirect: "manual",
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?error=1");

    // No real session cookie should be set (either absent or empty value)
    const setCookie = res.headers.get("set-cookie") ?? "";
    if (setCookie.includes("session=")) {
      // If header exists at all, value must be empty
      const match = setCookie.match(/session=([^;]*)/);
      expect(match![1]).toBe("");
    }
  });
});

describe("POST /logout", () => {
  it("303 to /login with Max-Age=0 cookie", async () => {
    const res = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      redirect: "manual",
    });

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
  });
});
