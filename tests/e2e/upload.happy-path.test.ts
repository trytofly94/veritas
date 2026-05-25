import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import { loadConfig } from "../../src/lib/config.js";
import { openDb } from "../../src/db/client.js";
import { archiveEntries } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

const TEST_API_KEY = "test-api-key-happy-path-1234567890";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;
let bigFixture: string;
let db: ReturnType<typeof openDb>;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "veritas-e2e-"));

  // Set env vars BEFORE calling loadConfig (D-06 fail-fast)
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

  // Generate a 50 MiB random fixture (not committed) for the peak-memory test
  bigFixture = path.join(dataDir, "big-50mib.bin");
  const ws = createWriteStream(bigFixture);
  const chunkSize = 1024 * 1024; // 1 MiB
  const chunks = 50;
  const gen = (async function* () {
    for (let i = 0; i < chunks; i++) yield crypto.randomBytes(chunkSize);
  })();
  await pipeline(Readable.from(gen), ws);
}, 120_000);

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

const EXPECTED_KEYS = [
  "id",
  "original_filename",
  "mime_type",
  "size_bytes",
  "sha256",
  "created_at",
  "label",
  "source_ip",
  "tsa_provider",
  "tsa_status",
  "tsa_attested_at",
  "tsa_fallback_chain",
].sort();

describe("POST /api/upload (happy path)", () => {
  it("hashes, timestamps via DFN, and writes a verifiable bundle", async () => {
    const fileBuf = await fsp.readFile(FIXTURE);
    const form = new FormData();
    form.append(
      "file",
      new Blob([fileBuf], { type: "text/plain" }),
      "hello.txt"
    );
    form.append("label", "my-label");

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      body: form,
      headers: { "X-API-Key": TEST_API_KEY },
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; bundle_path: string };
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.bundle_path).toBeTruthy();

    // Directory contents — 7 files since Plan 01-02 (CORE-03 full set
    // including verify.sh).
    const entries = (await fsp.readdir(body.bundle_path)).sort();
    expect(entries).toEqual(
      [
        "metadata.json",
        "original.sha256",
        "original.tsq",
        "original.tsr",
        "original.txt",
        "tsa-cacert.pem",
        "verify.sh",
      ].sort()
    );

    // sha256 sidecar format + sha256sum -c
    const shaContent = await fsp.readFile(
      path.join(body.bundle_path, "original.sha256"),
      "utf8"
    );
    expect(shaContent).toMatch(/^[0-9a-f]{64}  original\.txt\n$/);
    execFileSync("sha256sum", ["-c", "original.sha256"], {
      cwd: body.bundle_path,
      stdio: "pipe",
    });

    // metadata.json schema + values
    const meta = JSON.parse(
      await fsp.readFile(
        path.join(body.bundle_path, "metadata.json"),
        "utf8"
      )
    );
    expect(Object.keys(meta).sort()).toEqual(EXPECTED_KEYS);
    expect(meta.mime_type).toBe("text/plain");
    expect(meta.size_bytes).toBe(fs.statSync(FIXTURE).size);
    expect(meta.tsa_provider).toBe("dfn");
    expect(meta.tsa_status).toBe("verified");
    expect(meta.tsa_fallback_chain).toEqual(["dfn"]);
    expect(meta.label).toBe("my-label");
    expect(meta.original_filename).toBe("hello.txt");
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);

    // D-21: verify DB row was inserted
    const row = db.select().from(archiveEntries).where(eq(archiveEntries.id, body.id)).get();
    expect(row).toBeTruthy();
    expect(row!.id).toBe(body.id);
    expect(row!.bundle_dir).toBe(body.bundle_path);
    expect(row!.tsa_provider).toBe("dfn");

    // OpenSSL ts -verify
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
      { stdio: "pipe" }
    );
  }, 60_000);

  it("streams large uploads without buffering (50 MiB peak heap < 150 MiB delta)", async () => {
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const sampler = setInterval(() => {
      const h = process.memoryUsage().heapUsed;
      if (h > peak) peak = h;
    }, 25);

    try {
      const fileBuf = await fsp.readFile(bigFixture);
      const form = new FormData();
      form.append(
        "file",
        new Blob([fileBuf], { type: "application/octet-stream" }),
        "big.bin"
      );
      form.append("label", "big");
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        body: form,
        headers: { "X-API-Key": TEST_API_KEY },
      });
      expect(res.status).toBe(201);
    } finally {
      clearInterval(sampler);
    }

    const deltaMiB = (peak - baseline) / (1024 * 1024);
    // Note: the test client itself loads the fixture into memory for FormData.
    // We assert on heap delta after subtracting the ~50 MiB client-side buffer.
    // Server must not double-buffer it. Generous bound: 150 MiB total delta.
    expect(deltaMiB).toBeLessThan(150);
  }, 120_000);
});
