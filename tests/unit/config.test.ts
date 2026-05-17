import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Mirror the env-reset pattern from tests/unit/tsa.fallback.test.ts
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
  // Clear all relevant env vars before each test so tests are isolated
  delete process.env.API_KEY;
  delete process.env.SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.MANIFEST_DB_PATH;
  delete process.env.DATA_DIR;
  delete process.env.MAX_UPLOAD_BYTES;
});

afterEach(() => {
  restoreEnv();
});

// Dynamic import so we can re-evaluate with each env configuration
async function loadConfig() {
  const { loadConfig } = await import("../../src/lib/config.js");
  return loadConfig;
}

describe("loadConfig — D-06 fail-fast env validation", () => {
  it("Test 1: with all required env vars set, returns AppConfig with correct values", async () => {
    process.env.API_KEY = "test-api-key-value";
    process.env.SESSION_SECRET = "a-session-secret-that-is-at-least-32-bytes-long!";
    process.env.ADMIN_PASSWORD = "test-password";

    const { loadConfig } = await import("../../src/lib/config.js");
    const config = loadConfig();

    expect(config.apiKey).toBe("test-api-key-value");
    expect(config.sessionSecret).toBe("a-session-secret-that-is-at-least-32-bytes-long!");
    expect(config.adminPassword).toBe("test-password");
  });

  it("Test 2: missing API_KEY throws Error containing 'API_KEY'", async () => {
    process.env.SESSION_SECRET = "a-session-secret-that-is-at-least-32-bytes-long!";
    process.env.ADMIN_PASSWORD = "test-password";

    const { loadConfig } = await import("../../src/lib/config.js");
    expect(() => loadConfig()).toThrow(/API_KEY/);
  });

  it("Test 3: empty SESSION_SECRET throws Error containing 'SESSION_SECRET'", async () => {
    process.env.API_KEY = "test-api-key";
    process.env.SESSION_SECRET = "";
    process.env.ADMIN_PASSWORD = "test-password";

    const { loadConfig } = await import("../../src/lib/config.js");
    expect(() => loadConfig()).toThrow(/SESSION_SECRET/);
  });

  it("Test 4: SESSION_SECRET shorter than 32 bytes throws Error containing '32 bytes'", async () => {
    process.env.API_KEY = "test-api-key";
    process.env.SESSION_SECRET = "short-secret"; // < 32 bytes
    process.env.ADMIN_PASSWORD = "test-password";

    const { loadConfig } = await import("../../src/lib/config.js");
    expect(() => loadConfig()).toThrow(/32 bytes/);
  });

  it("Test 5: MANIFEST_DB_PATH unset defaults to '/data/manifest.sqlite'", async () => {
    process.env.API_KEY = "test-api-key";
    process.env.SESSION_SECRET = "a-session-secret-that-is-at-least-32-bytes-long!";
    process.env.ADMIN_PASSWORD = "test-password";

    const { loadConfig } = await import("../../src/lib/config.js");
    const config = loadConfig();

    expect(config.manifestDbPath).toBe("/data/manifest.sqlite");
  });

  it("Test 6: MAX_UPLOAD_BYTES unset defaults to 104857600 (100 MiB)", async () => {
    process.env.API_KEY = "test-api-key";
    process.env.SESSION_SECRET = "a-session-secret-that-is-at-least-32-bytes-long!";
    process.env.ADMIN_PASSWORD = "test-password";

    const { loadConfig } = await import("../../src/lib/config.js");
    const config = loadConfig();

    expect(config.maxUploadBytes).toBe(104857600);
  });

  it("Test 7: MAX_UPLOAD_BYTES='50000000' is parsed as number 50000000", async () => {
    process.env.API_KEY = "test-api-key";
    process.env.SESSION_SECRET = "a-session-secret-that-is-at-least-32-bytes-long!";
    process.env.ADMIN_PASSWORD = "test-password";
    process.env.MAX_UPLOAD_BYTES = "50000000";

    const { loadConfig } = await import("../../src/lib/config.js");
    const config = loadConfig();

    expect(config.maxUploadBytes).toBe(50000000);
    expect(typeof config.maxUploadBytes).toBe("number");
  });
});
