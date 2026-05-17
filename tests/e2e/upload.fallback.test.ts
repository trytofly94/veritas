import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;

beforeAll(async () => {
  // Force DFN to be unreachable BEFORE the server boots.
  process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
  process.env.TSA_TIMEOUT_MS = "3000";
  delete process.env.TSA_FREETSA_ENDPOINT;
  delete process.env.TSA_DIGICERT_ENDPOINT;

  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-e2e-fallback-"));
  process.env.DATA_DIR = dataDir;

  // Fresh module load so the upload route picks the current env.
  const { createApp } = await import("../../src/server.js");
  const app = createApp();
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
  it("returns 502 with all_tsas_failed and writes nothing to DATA_DIR", async () => {
    // Stop the existing server and bring up a fresh one with ALL three endpoints
    // blackholed. We do this by overriding ad-hoc with another DATA_DIR for
    // perfect isolation.
    const downDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "auto-archive-e2e-alldown-"),
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
      };
      process.env.DATA_DIR = downDir;
      process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
      process.env.TSA_FREETSA_ENDPOINT = "http://127.0.0.1:1";
      process.env.TSA_DIGICERT_ENDPOINT = "http://127.0.0.1:1";
      process.env.TSA_TIMEOUT_MS = "1500";

      // Fresh server instance with the new env.
      const { createApp } = await import("../../src/server.js");
      const app = createApp();
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
        });
        expect(res.status).toBe(502);
        const body = (await res.json()) as { error: string; chain: string[] };
        expect(body.error).toBe("all_tsas_failed");
        expect(body.chain).toEqual(["dfn", "freetsa", "digicert"]);

        const after = (await fsp.readdir(downDir)).filter(
          (e) => !e.startsWith("."),
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
      }
    } finally {
      await fsp.rm(downDir, { recursive: true, force: true });
    }
    // Silence unused-import warning for fs in some toolchains
    void fs;
  }, 30_000);
});
