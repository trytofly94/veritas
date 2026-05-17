import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";

// IMPORTANT: env overrides must be applied BEFORE we dynamically import the
// module under test, because getTsaProviders() reads them at call time. We
// still re-import inside each test to pick up the current env.
async function loadFallback() {
  return await import("../../src/lib/tsa.js");
}

const ORIG_ENV = { ...process.env };

function restoreEnv() {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIG_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    process.env[k] = v as string;
  }
}

beforeEach(() => {
  vi.resetModules();
  // Defensive: another test file running in the same worker may have
  // mutated TSA_*_ENDPOINT and not yet restored. Clear all overrides at the
  // start of each unit test; tests set what they need explicitly.
  delete process.env.TSA_DFN_ENDPOINT;
  delete process.env.TSA_FREETSA_ENDPOINT;
  delete process.env.TSA_DIGICERT_ENDPOINT;
  delete process.env.TSA_TIMEOUT_MS;
});

afterEach(() => {
  restoreEnv();
  vi.useRealTimers();
});

const DIGEST = "7b20c4d7342c8ba62963e7c98474ae7f4f27a68c296c3ed6cf30f68dd44f88ea";

describe("requestTimestampWithFallback — happy / fallback paths", () => {
  it("falls back DFN → FreeTSA when DFN endpoint is unreachable (real FreeTSA)", async () => {
    process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
    process.env.TSA_TIMEOUT_MS = "3000";
    const { requestTimestampWithFallback } = await loadFallback();
    const res = await requestTimestampWithFallback(DIGEST);
    expect(res.provider).toBe("freetsa");
    expect(res.fallbackChain).toEqual(["dfn", "freetsa"]);
    expect(res.caCertPath).toContain("freetsa.pem");
    expect(res.tsr.length).toBeGreaterThan(100);
    expect(res.attestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }, 30_000);

  it("falls back DFN → FreeTSA → DigiCert when first two are unreachable (real DigiCert)", async () => {
    process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
    process.env.TSA_FREETSA_ENDPOINT = "http://127.0.0.1:1";
    process.env.TSA_TIMEOUT_MS = "3000";
    const { requestTimestampWithFallback } = await loadFallback();
    const res = await requestTimestampWithFallback(DIGEST);
    expect(res.provider).toBe("digicert");
    expect(res.fallbackChain).toEqual(["dfn", "freetsa", "digicert"]);
    expect(res.caCertPath).toContain("digicert.pem");
    expect(res.tsr.length).toBeGreaterThan(100);
  }, 30_000);

  it("throws AllTsasFailed with chain=['dfn','freetsa','digicert'] when all fail", async () => {
    process.env.TSA_DFN_ENDPOINT = "http://127.0.0.1:1";
    process.env.TSA_FREETSA_ENDPOINT = "http://127.0.0.1:1";
    process.env.TSA_DIGICERT_ENDPOINT = "http://127.0.0.1:1";
    process.env.TSA_TIMEOUT_MS = "1500";
    const { requestTimestampWithFallback, AllTsasFailed } = await loadFallback();
    await expect(requestTimestampWithFallback(DIGEST)).rejects.toBeInstanceOf(
      AllTsasFailed,
    );
    try {
      await requestTimestampWithFallback(DIGEST);
    } catch (err) {
      expect(err).toBeInstanceOf(AllTsasFailed);
      expect((err as InstanceType<typeof AllTsasFailed>).chain).toEqual([
        "dfn",
        "freetsa",
        "digicert",
      ]);
    }
  }, 30_000);
});

describe("requestTimestampWithFallback — timeout path (sloth endpoint)", () => {
  let slothServer: http.Server;
  let slothPort: number;

  beforeEach(async () => {
    // Stand up a TCP server that accepts the connection but never replies —
    // exercises the AbortController timeout path (NOT ECONNREFUSED).
    slothServer = http.createServer((_req, _res) => {
      // intentionally do nothing — the request hangs until aborted
    });
    await new Promise<void>((resolve) =>
      slothServer.listen(0, "127.0.0.1", () => resolve()),
    );
    slothPort = (slothServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      slothServer.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("treats a sloth endpoint (accepts connection, never replies) as a timeout failure", async () => {
    process.env.TSA_DFN_ENDPOINT = `http://127.0.0.1:${slothPort}`;
    process.env.TSA_FREETSA_ENDPOINT = `http://127.0.0.1:${slothPort}`;
    process.env.TSA_DIGICERT_ENDPOINT = `http://127.0.0.1:${slothPort}`;
    // Use a SHORT timeout (500ms) so the test runs in <2s while still
    // proving the timeout-not-ECONNREFUSED path is exercised.
    process.env.TSA_TIMEOUT_MS = "500";
    const { requestTimestampWithFallback, AllTsasFailed } = await loadFallback();
    const start = Date.now();
    let caught: unknown;
    try {
      await requestTimestampWithFallback(DIGEST);
    } catch (e) {
      caught = e;
    }
    const elapsed = Date.now() - start;
    expect(caught).toBeInstanceOf(AllTsasFailed);
    const failure = caught as InstanceType<typeof AllTsasFailed>;
    // Each attempt should hit the timeout, not error instantly. With 500ms
    // per provider × 3 providers, total elapsed must be >= ~1300ms (allowing
    // some scheduler slack). If it were ECONNREFUSED we'd see <50ms.
    expect(elapsed).toBeGreaterThanOrEqual(1200);
    // Errors should mention timeout / abort, not ECONNREFUSED.
    const joinedMessages = failure.attempts
      .map((a) => a.error.toLowerCase())
      .join(" | ");
    expect(joinedMessages).not.toContain("econnrefused");
    expect(joinedMessages).toMatch(/(abort|timeout|signal)/);
  }, 15_000);
});

describe("requestTimestampWithFallback — verify failure rejects provider", () => {
  it("when a provider returns a TSR that fails verifyTsr, the chain continues", async () => {
    // Stand up a local HTTP server that returns garbage bytes with the
    // correct content type — this will parse as ASN.1 either not at all
    // (caught by parseGenTime) or will fail verifyTsr. Either way the
    // provider is recorded as failed.
    const garbageServer = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/timestamp-reply");
      // Random 200 bytes — not a valid TSR
      res.end(Buffer.alloc(200, 0x42));
    });
    await new Promise<void>((resolve) =>
      garbageServer.listen(0, "127.0.0.1", () => resolve()),
    );
    const port = (garbageServer.address() as AddressInfo).port;
    try {
      process.env.TSA_DFN_ENDPOINT = `http://127.0.0.1:${port}`;
      // Let FreeTSA stay real so the chain succeeds at step 2 and we can
      // assert the rejection happened for DFN.
      process.env.TSA_TIMEOUT_MS = "5000";
      const { requestTimestampWithFallback } = await loadFallback();
      const res = await requestTimestampWithFallback(DIGEST);
      // DFN was rejected (parse OR verify failure); FreeTSA succeeded
      expect(res.provider).toBe("freetsa");
      expect(res.fallbackChain).toEqual(["dfn", "freetsa"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        garbageServer.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }, 30_000);
});

describe("getTsaProviders — committed cert chains exist", () => {
  it("every provider's caCertPath points at a real, non-empty PEM file in the repo", async () => {
    const { getTsaProviders } = await import("../../src/lib/tsaProviders.js");
    for (const p of getTsaProviders()) {
      const abs = path.resolve(process.cwd(), p.caCertPath);
      expect(fs.existsSync(abs), `missing CA file: ${abs}`).toBe(true);
      const pem = fs.readFileSync(abs, "utf8");
      expect(pem).toMatch(/-----BEGIN CERTIFICATE-----/);
      expect(pem).toMatch(/-----END CERTIFICATE-----/);
    }
  });
});
