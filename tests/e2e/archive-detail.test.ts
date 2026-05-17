/**
 * E2e tests for GET /archive/:id (Phase 3 — BROWSE-02).
 * Verifies auth gate, ULID validation, render correctness, HTML-not-JSON 500
 * on missing metadata.json (plan-checker W3), and W4 field-name regression.
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

const TEST_API_KEY = "test-api-key-archive-detail-1234567890";
const TEST_ADMIN_PASSWORD = "test-pass-archive-detail";
const TEST_SESSION_SECRET =
  "test-session-secret-must-be-32-plus-bytes-long-yo";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let db: ReturnType<typeof openDb>;
let validCookie: string;
let sharedId: string;
let sharedBundleDir: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "auto-archive-detail-e2e-"),
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

  // Seed a real upload so metadata.json + original.txt exist on disk.
  const fileBuf = await fsp.readFile(FIXTURE);
  const form = new FormData();
  form.append("file", new Blob([fileBuf], { type: "text/plain" }), "hello.txt");
  form.append("label", "Detail Test Bundle");
  const res = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    body: form,
    headers: { "X-API-Key": TEST_API_KEY },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  sharedId = body.id;
  sharedBundleDir = path.join(dataDir, sharedId);
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

describe("GET /archive/:id — auth gate", () => {
  it("redirects to /login?next=%2Farchive%2F<id> when no session cookie", async () => {
    const res = await fetch(`${baseUrl}/archive/${sharedId}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `/login?next=%2Farchive%2F${sharedId}`,
    );
  });
});

describe("GET /archive/:id — ULID validation", () => {
  it("returns 404 HTML page with 'Eintrag nicht gefunden.' on invalid ULID", async () => {
    const res = await fetch(`${baseUrl}/archive/not-a-ulid-12345`, {
      redirect: "manual",
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Eintrag nicht gefunden.");
  });

  it("returns 404 HTML page on unknown but valid ULID", async () => {
    const res = await fetch(
      `${baseUrl}/archive/01ZZZZZZZZZZZZZZZZZZZZZZZZ`,
      {
        redirect: "manual",
        headers: { Cookie: `session=${validCookie}` },
      },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Eintrag nicht gefunden.");
  });
});

describe("GET /archive/:id — content", () => {
  it("returns 200 with all metadata labels, filename, badge, and download link", async () => {
    const res = await fetch(`${baseUrl}/archive/${sharedId}`, {
      redirect: "manual",
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    for (const label of [
      "Archiv-ID",
      "Bezeichnung",
      "Dateigröße",
      "Dateityp",
      "SHA-256",
      "Server-Zeitstempel",
      "TSA-Zeitstempel",
      "TSA-Anbieter",
      "Quell-IP",
    ]) {
      expect(body).toContain(label);
    }
    expect(body).toContain("hello.txt");
    expect(body).toContain(`/api/download/${sharedId}`);
    expect(body).toContain("Archiv-Bundle herunterladen");
    expect(body).toContain("tsa-badge"); // badge class
  });

  it("renders aria-live='polite' on the verify result container", async () => {
    const res = await fetch(`${baseUrl}/archive/${sharedId}`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).toContain('aria-live="polite"');
  });

  it("references /static/archive-detail.js in the rendered HTML", async () => {
    const res = await fetch(`${baseUrl}/archive/${sharedId}`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).toContain("/static/archive-detail.js");
  });

  it("serves /static/archive-detail.js with text/javascript content-type", async () => {
    const res = await fetch(`${baseUrl}/static/archive-detail.js`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/javascript/);
    const body = await res.text();
    expect(body).toContain("verifyIntegrity");
  });
});

describe("GET /archive/:id — W3 HTML-not-JSON 500 on missing metadata.json", () => {
  it("returns text/html 500 with German error string when metadata.json is missing", async () => {
    // Seed a fresh upload so we can corrupt it without affecting other tests.
    const fileBuf = await fsp.readFile(FIXTURE);
    const form = new FormData();
    form.append("file", new Blob([fileBuf], { type: "text/plain" }), "corrupt.txt");
    form.append("label", "Corruptible");
    const upRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
      headers: { "X-API-Key": TEST_API_KEY },
    });
    expect(upRes.status).toBe(201);
    const { id: corruptId } = (await upRes.json()) as { id: string };
    const corruptDir = path.join(dataDir, corruptId);
    const metadataPath = path.join(corruptDir, "metadata.json");

    // Files in the bundle are chmod 444 — chmod the dir writable so we can unlink.
    await fsp.chmod(corruptDir, 0o755);
    await fsp.chmod(metadataPath, 0o644);
    await fsp.unlink(metadataPath);

    const res = await fetch(`${baseUrl}/archive/${corruptId}`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain(
      "Fehler beim Laden des Eintrags. Bitte Seite neu laden.",
    );
    // W3 — no JSON envelope leakage to the browser:
    expect(body).not.toContain('"error":true');
    expect(body).not.toContain('"code":"INTERNAL_ERROR"');
  });
});

describe("GET /archive/:id — W4 regression guard", () => {
  it("rendered HTML contains NO occurrence of the obsolete 'tsa_attested_time' string", async () => {
    const res = await fetch(`${baseUrl}/archive/${sharedId}`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).not.toContain("tsa_attested_time");
  });
});
