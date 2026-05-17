import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";

/**
 * Compute the SHA-256 of a file by streaming it through crypto.createHash.
 * Returns the lowercase hex digest. Constant memory (default 64 KiB chunks).
 */
export async function sha256OfFile(absPath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(absPath), hash);
  return hash.digest("hex");
}
