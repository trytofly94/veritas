/**
 * E2e tests for the Phase 3 archive list route — GET /archive.
 * Verifies BROWSE-01: auth gate, empty state, populated list, sort order,
 * TSA badge mapping, type column, per-row anchor with title attribute, and
 * absence of row-level JS handlers.
 *
 * Harness follows the canonical pattern from tests/e2e/upload.happy-path.test.ts:
 * port 0, tmp DATA_DIR, env vars set before loadConfig.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { openDb } from "../../src/db/client.js";
import { archiveEntries } from "../../src/db/schema.js";
import { signSessionCookie } from "../../src/lib/sessionCookie.js";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const TEST_API_KEY = "test-api-key-archive-list-1234567890";
const TEST_ADMIN_PASSWORD = "test-pass-archive-list";
const TEST_SESSION_SECRET =
  "test-session-secret-must-be-32-plus-bytes-long-yo";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let db: ReturnType<typeof openDb>;
let validCookie: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "auto-archive-list-e2e-"),
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

  // Forge a valid session cookie inline (matches Phase 2 login route output).
  const now = Date.now();
  validCookie = signSessionCookie(
    { user: "admin", iat: now, exp: now + 3_600_000 },
    TEST_SESSION_SECRET,
  );
});

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

beforeEach(() => {
  // Clean slate per test — full table delete so order/empty-state tests are
  // independent.
  db.delete(archiveEntries).run();
});

function seedRow(overrides: {
  id: string;
  original_filename: string;
  mime_type: string;
  created_at: string;
  tsa_provider?: string;
  tsa_status?: string;
}) {
  db.insert(archiveEntries)
    .values({
      id: overrides.id,
      original_filename: overrides.original_filename,
      mime_type: overrides.mime_type,
      size_bytes: 1234,
      sha256: "a".repeat(64),
      created_at: overrides.created_at,
      label: "",
      source_ip: "127.0.0.1",
      tsa_provider: overrides.tsa_provider ?? "dfn",
      tsa_status: overrides.tsa_status ?? "verified",
      tsa_attested_at: overrides.created_at,
      tsa_fallback_chain: JSON.stringify([overrides.tsa_provider ?? "dfn"]),
      bundle_dir: path.join(dataDir, "bundles", overrides.id),
    })
    .run();
}

describe("GET /archive — auth gate", () => {
  it("redirects to /login?next=%2Farchive when no session cookie is present", async () => {
    const res = await fetch(`${baseUrl}/archive`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?next=%2Farchive");
  });

  it("redirects to /login?next=%2Farchive when session cookie HMAC is invalid", async () => {
    // Tamper the MAC portion of the cookie
    const parts = validCookie.split(".");
    const tampered =
      parts[0] +
      "." +
      parts[1].slice(0, -1) +
      (parts[1].endsWith("a") ? "b" : "a");

    const res = await fetch(`${baseUrl}/archive`, {
      redirect: "manual",
      headers: { Cookie: `session=${tampered}` },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login?next=%2Farchive");
  });
});

describe("GET /archive — content", () => {
  it("returns 200 + empty-state HTML when the manifest is empty", async () => {
    const res = await fetch(`${baseUrl}/archive`, {
      redirect: "manual",
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Noch keine Dateien archiviert.");
    expect(body).toContain(
      '<a class="btn btn--secondary" href="/">Datei hochladen</a>',
    );
    expect(body).toContain("<title>Archiv — auto-archive</title>");
  });

  it("returns 200 + 3 rows in descending created_at order", async () => {
    seedRow({
      id: "01OLDESTOLDESTOLDESTOLDEST",
      original_filename: "oldest.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-15T10:00:00Z",
    });
    seedRow({
      id: "01MIDMIDMIDMIDMIDMIDMIDMID",
      original_filename: "middle.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-16T10:00:00Z",
    });
    seedRow({
      id: "01NEWESTNEWESTNEWESTNEWES1",
      original_filename: "newest.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-17T10:00:00Z",
    });

    const res = await fetch(`${baseUrl}/archive`, {
      redirect: "manual",
      headers: { Cookie: `session=${validCookie}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    const tbodyMatch = body.match(/<tbody>([\s\S]*?)<\/tbody>/);
    expect(tbodyMatch).toBeTruthy();
    const tbody = tbodyMatch![1];

    // Count <tr> rows inside tbody
    const trCount = (tbody.match(/<tr>/g) ?? []).length;
    expect(trCount).toBe(3);

    // Order: newest first → middle → oldest
    const iNewest = tbody.indexOf("newest.pdf");
    const iMiddle = tbody.indexOf("middle.pdf");
    const iOldest = tbody.indexOf("oldest.pdf");
    expect(iNewest).toBeGreaterThan(-1);
    expect(iMiddle).toBeGreaterThan(iNewest);
    expect(iOldest).toBeGreaterThan(iMiddle);
  });

  it("renders tsa-badge--ok for tsa_provider=dfn + tsa_status=verified", async () => {
    seedRow({
      id: "01DFNROW00000000000000000",
      original_filename: "dfn.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-17T10:00:00Z",
      tsa_provider: "dfn",
      tsa_status: "verified",
    });

    const res = await fetch(`${baseUrl}/archive`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).toMatch(/<span class="tsa-badge tsa-badge--ok">DFN<\/span>/);
  });

  it("renders tsa-badge--local for tsa_provider=local-fallback", async () => {
    seedRow({
      id: "01LOCALROW0000000000000000",
      original_filename: "local.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-17T10:00:00Z",
      tsa_provider: "local-fallback",
      tsa_status: "ok",
    });

    const res = await fetch(`${baseUrl}/archive`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).toMatch(
      /<span class="tsa-badge tsa-badge--local">Lokal<\/span>/,
    );
  });

  it("renders tsa-badge--failed when tsa_status=failed", async () => {
    seedRow({
      id: "01FAILEDROW000000000000000",
      original_filename: "failed.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-17T10:00:00Z",
      tsa_provider: "dfn",
      tsa_status: "failed",
    });

    const res = await fetch(`${baseUrl}/archive`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).toMatch(
      /<span class="tsa-badge tsa-badge--failed">Fehlgeschlagen<\/span>/,
    );
  });

  it("renders type column as 'PDF' for mime_type=application/pdf", async () => {
    seedRow({
      id: "01TYPEPDFROW00000000000000",
      original_filename: "type.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-17T10:00:00Z",
    });

    const res = await fetch(`${baseUrl}/archive`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    // The PDF cell sits between two <td> tags; assert the substring.
    expect(body).toContain("<td>PDF</td>");
  });

  it("row's first cell contains <a href=/archive/{id}> with title attribute equal to original_filename", async () => {
    const id = "01TITLEROW00000000000000000";
    const filename = "title-test.pdf";
    seedRow({
      id,
      original_filename: filename,
      mime_type: "application/pdf",
      created_at: "2026-05-17T10:00:00Z",
    });

    const res = await fetch(`${baseUrl}/archive`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).toMatch(
      new RegExp(
        `<a\\s+href="/archive/${id}"\\s+title="${filename.replace(".", "\\.")}">${filename.replace(".", "\\.")}</a>`,
      ),
    );
  });

  it("rendered <tr> elements contain NO onclick attribute (cell anchor only)", async () => {
    seedRow({
      id: "01NOONCLICKROW0000000000000",
      original_filename: "no-onclick.pdf",
      mime_type: "application/pdf",
      created_at: "2026-05-17T10:00:00Z",
    });

    const res = await fetch(`${baseUrl}/archive`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body.includes("onclick=")).toBe(false);
    expect(body.includes("onkeydown=")).toBe(false);
  });

  it("renders the header link 'Neue Datei hochladen' pointing to /", async () => {
    const res = await fetch(`${baseUrl}/archive`, {
      headers: { Cookie: `session=${validCookie}` },
    });
    const body = await res.text();
    expect(body).toMatch(
      /<a class="btn btn--secondary" href="\/">Neue Datei hochladen<\/a>/,
    );
  });
});
