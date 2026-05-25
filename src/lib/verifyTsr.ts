import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

const execFile = promisify(execFileCb);

export interface VerifyTsrArgs {
  /** RFC 3161 TimeStampResp bytes (full reply). */
  tsr: Buffer;
  /** Absolute path to the original data file the TSR attests over. */
  dataPath: string;
  /** Absolute or repo-relative path to the CA cert chain PEM. */
  caCertPath: string;
}

/**
 * Verify an RFC 3161 TimeStampResp via `openssl ts -verify`.
 *
 * Writes the TSR to a unique temp file (openssl needs a file path), then
 * invokes:
 *
 *   openssl ts -verify -in <tsr> -data <data> -CAfile <ca>
 *
 * Resolves on exit 0; throws an Error carrying openssl's stderr otherwise.
 * Pre-finalization callers MUST treat a thrown error as proof that the TSR
 * is unacceptable (forged, wrong chain, or unsigned) and reject the
 * candidate provider (D-09 chain).
 */
export async function verifyTsr(args: VerifyTsrArgs): Promise<void> {
  const { tsr, dataPath, caCertPath } = args;

  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const tsrPath = path.join(os.tmpdir(), `veritas-verify-${unique}.tsr`);
  await fsp.writeFile(tsrPath, tsr);

  try {
    await execFile(
      "openssl",
      ["ts", "-verify", "-in", tsrPath, "-data", dataPath, "-CAfile", caCertPath],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(
      `openssl ts -verify failed: ${e.stderr?.trim() || e.message}`,
    );
  } finally {
    await fsp.unlink(tsrPath).catch(() => {});
  }
}
