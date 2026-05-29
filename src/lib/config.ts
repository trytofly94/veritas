/**
 * D-06: Fail-fast startup configuration validation.
 * Reads all required env vars; throws on any missing/short value before port bind.
 * D-25: Defines all Phase 2 env vars with their defaults.
 */

import * as path from "node:path";

export interface AppConfig {
  apiKey: string;
  sessionSecret: string;
  adminPassword: string;
  manifestDbPath: string; // default: "/data/manifest.sqlite"
  dataDir: string;        // default: path.resolve(process.cwd(), "data")
  maxUploadBytes: number; // default: 100 * 1024 * 1024 (100 MiB)
  cookieSecure: boolean;  // default: true; set COOKIE_SECURE=false for plain-HTTP LAN access
}

/**
 * Read a required env var; throw a descriptive error if missing or empty.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/**
 * Load and validate all configuration from environment variables.
 * Throws an Error with a descriptive message if any required var is missing/invalid.
 * Call once from index.ts before binding the server port (D-06).
 */
export function loadConfig(): AppConfig {
  const apiKey = required("API_KEY");
  const sessionSecret = required("SESSION_SECRET");

  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }

  const adminPassword = required("ADMIN_PASSWORD");

  return {
    apiKey,
    sessionSecret,
    adminPassword,
    manifestDbPath: process.env.MANIFEST_DB_PATH ?? "/data/manifest.sqlite",
    dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), "data"),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
    cookieSecure: process.env.COOKIE_SECURE !== "false",
  };
}
