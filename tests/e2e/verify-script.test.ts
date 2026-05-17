import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const FIXTURE = path.resolve(__dirname, "../fixtures/hello.txt");

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;

beforeAll(async () => {
  // Use real DFN for the happy bundle.
  delete process.env.TSA_DFN_ENDPOINT;
  delete process.env.TSA_FREETSA_ENDPOINT;
  delete process.env.TSA_DIGICERT_ENDPOINT;
  process.env.TSA_TIMEOUT_MS = "10000";

  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-e2e-verify-"));
  process.env.DATA_DIR = dataDir;

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
  delete process.env.TSA_TIMEOUT_MS;
});

async function uploadFixture(): Promise<string> {
  const fileBuf = await fsp.readFile(FIXTURE);
  const form = new FormData();
  form.append("file", new Blob([fileBuf], { type: "text/plain" }), "hello.txt");
  form.append("label", "verify-script-test");
  const res = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    body: form,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; bundle_path: string };
  return body.bundle_path;
}

/**
 * Bundles are 0444 (read-only). For tamper tests we copy to a writable tmp
 * dir, then chmod +w to allow editing.
 */
async function copyToWritable(src: string): Promise<string> {
  const dst = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-bundle-copy-"));
  for (const entry of await fsp.readdir(src)) {
    await fsp.copyFile(path.join(src, entry), path.join(dst, entry));
  }
  // chmod every entry +rw so tamper tests can edit; verify.sh stays +x
  for (const entry of await fsp.readdir(dst)) {
    await fsp.chmod(path.join(dst, entry), 0o644);
  }
  // Re-mark verify.sh executable for the test harness.
  await fsp.chmod(path.join(dst, "verify.sh"), 0o755);
  return dst;
}

describe("verify.sh in every bundle (CORE-04)", () => {
  it("bundle has all 7 files with correct modes (verify.sh=555, others=444)", async () => {
    const bundle = await uploadFixture();
    const entries = (await fsp.readdir(bundle)).sort();
    expect(entries).toEqual(
      [
        "metadata.json",
        "original.sha256",
        "original.tsq",
        "original.tsr",
        "original.txt",
        "tsa-cacert.pem",
        "verify.sh",
      ].sort(),
    );
    const verifyStat = await fsp.stat(path.join(bundle, "verify.sh"));
    expect(verifyStat.mode & 0o777).toBe(0o555);
    for (const entry of entries) {
      if (entry === "verify.sh") continue;
      const st = await fsp.stat(path.join(bundle, entry));
      expect(st.mode & 0o777).toBe(0o444);
    }
  }, 60_000);

  it("running verify.sh from the bundle dir exits 0 with VERIFICATION SUCCESS", async () => {
    const bundle = await uploadFixture();
    const out = execFileSync("sh", ["verify.sh"], {
      cwd: bundle,
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(out).toContain("VERIFICATION SUCCESS");
  }, 60_000);

  it("sha256sum -c on original.sha256 from inside the bundle dir exits 0", async () => {
    const bundle = await uploadFixture();
    const tool = process.platform === "darwin" ? "shasum" : "sha256sum";
    const args = process.platform === "darwin"
      ? ["-a", "256", "-c", "original.sha256"]
      : ["-c", "original.sha256"];
    execFileSync(tool, args, { cwd: bundle, stdio: "pipe" });
  }, 60_000);

  it("tampering with original.<ext> → exit non-zero with SHA256 MISMATCH", async () => {
    const bundle = await uploadFixture();
    const copy = await copyToWritable(bundle);
    try {
      await fsp.appendFile(path.join(copy, "original.txt"), "x");
      const result = spawnSync("sh", ["verify.sh"], {
        cwd: copy,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("SHA256 MISMATCH");
    } finally {
      await fsp.rm(copy, { recursive: true, force: true });
    }
  }, 60_000);

  it("tampering with original.tsr → exit non-zero with TIMESTAMP VERIFICATION FAILED", async () => {
    const bundle = await uploadFixture();
    const copy = await copyToWritable(bundle);
    try {
      // Replace tsr with 100 bytes of random — invalid ASN.1.
      const random = await fsp.readFile("/dev/urandom").catch(() => {
        // /dev/urandom may not be readable in full; we only need 100 bytes
        return Buffer.alloc(0);
      });
      const garbage =
        random.length >= 100
          ? random.subarray(0, 100)
          : Buffer.from(
              "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            ).subarray(0, 100);
      await fsp.writeFile(path.join(copy, "original.tsr"), garbage);
      const result = spawnSync("sh", ["verify.sh"], {
        cwd: copy,
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("TIMESTAMP VERIFICATION FAILED");
    } finally {
      await fsp.rm(copy, { recursive: true, force: true });
    }
  }, 60_000);

  it("verify.sh contains no absolute build-host paths (comment-stripped)", async () => {
    const tpl = await fsp.readFile(
      path.resolve(process.cwd(), "assets/verify-template.sh"),
      "utf8",
    );
    const nonCommentLines = tpl
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(nonCommentLines).not.toMatch(/\/(Users|home|tmp)\//);
  });
});
