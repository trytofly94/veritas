import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as path from "node:path";

/**
 * Wraps scripts/smoke-container.sh so CI / `npm test` can gate on the full
 * containerized smoke flow (docker build + compose up + curl POST + verify.sh
 * on host + isolation assertion + compose down).
 *
 * Skipped automatically if Docker is not available on the host so unit-only
 * CI environments don't break.
 */

const repoRoot = path.resolve(__dirname, "../..");
const scriptPath = path.join(repoRoot, "scripts", "smoke-container.sh");

function dockerAvailable(): boolean {
  try {
    execSync("docker version --format '{{.Server.Version}}'", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe("container smoke (Plan 01-03 Task 1)", () => {
  const hasDocker = dockerAvailable();
  const runner = hasDocker ? it : it.skip;

  // Building + starting a container, doing a real DFN TSA round trip, and
  // tearing the stack down can easily take well over a minute on a cold
  // machine. Cap at 5 min so we don't get false negatives.
  runner(
    "scripts/smoke-container.sh exits 0 end-to-end",
    () => {
      const out = execSync(`bash ${scriptPath}`, {
        cwd: repoRoot,
        stdio: "pipe",
        env: process.env,
      }).toString();
      expect(out + "").toMatch(/OK — container smoke passed/);
    },
    { timeout: 5 * 60_000 },
  );
});
