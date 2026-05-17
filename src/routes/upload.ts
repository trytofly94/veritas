import type { Hono, Context } from "hono";
import Busboy from "busboy";
import { z } from "zod";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";

import { sha256OfFile } from "../lib/hash.js";
import { requestTimestampWithFallback, AllTsasFailed } from "../lib/tsa.js";
import { writeBundle } from "../lib/bundle.js";
import { buildMetadata } from "../lib/metadata.js";
import { newId } from "../lib/ids.js";
import { resolveSourceIp } from "../lib/sourceIp.js";

/** Cap any single upload body at 100 MiB (T-01-02). */
const MAX_BODY_BYTES = 100 * 1024 * 1024;

/** Reasonable cap on the optional `label` text. */
const LabelSchema = z.string().max(200);

/**
 * Multipart upload result captured from busboy. We stream the file part
 * directly to a per-request temp file (no full-body buffering — CONCERN-3).
 */
interface ParsedUpload {
  filename: string;
  tempPath: string;
  sizeBytes: number;
  label: string;
}

class UploadError extends Error {
  constructor(public status: 400 | 413, msg: string) {
    super(msg);
  }
}

/**
 * Stream the multipart body off the raw IncomingMessage via busboy into a
 * temp file. Returns when busboy finishes (or rejects on any error / size
 * cap breach). Cleans up the temp file on error.
 */
function streamMultipart(req: IncomingMessage): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    let bb: Busboy.Busboy;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_BODY_BYTES, files: 1, fields: 10 },
      });
    } catch (err) {
      reject(new UploadError(400, `invalid multipart headers: ${(err as Error).message}`));
      return;
    }

    let filename: string | undefined;
    let tempPath: string | undefined;
    let sizeBytes = 0;
    let label: string | undefined;
    let fileSeen = false;
    let truncated = false;
    let settled = false;
    // CR-01: track the per-file pipeline() promise so bb.on("close") can
    // await it before resolving. Without this, on small uploads bb fires
    // "close" before the WriteStream has flushed, and the route hashes a
    // partial file — breaking the forensic invariant that the bundle's
    // SHA-256 equals the bytes received.
    let writePromise: Promise<void> | undefined;

    const cleanup = async () => {
      if (tempPath) {
        await fsp.unlink(tempPath).catch(() => {});
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup().finally(() => reject(err));
    };

    bb.on("file", (fieldname, fileStream, info) => {
      if (fileSeen) {
        // Spec says one file; ignore subsequent and drain to avoid back-pressure.
        fileStream.resume();
        return;
      }
      fileSeen = true;
      filename = info.filename || "upload.bin";
      tempPath = path.join(os.tmpdir(), `auto-archive-upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      const out = fs.createWriteStream(tempPath);
      fileStream.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
      });
      fileStream.on("limit", () => {
        truncated = true;
      });
      writePromise = pipeline(fileStream, out);
      // Suppress unhandled-rejection; the real handling happens in
      // bb.on("close") (success path) or fail() (early-error path).
      writePromise.catch(() => {});
    });

    bb.on("field", (fieldname, value) => {
      if (fieldname === "label") {
        label = value;
      }
    });

    bb.on("error", (err) => fail(err as Error));
    bb.on("close", () => {
      if (settled) return;
      if (!fileSeen || !tempPath || !filename) {
        fail(new UploadError(400, "missing 'file' part in multipart body"));
        return;
      }
      if (truncated) {
        fail(new UploadError(413, `upload exceeds ${MAX_BODY_BYTES} byte limit`));
        return;
      }
      // CR-03: When no label is provided, derive it from the filename but
      // cap to 200 chars (LabelSchema's max). NTFS/ext4 allow 255-byte
      // filenames, so silently failing label validation on the
      // filename-derived default would 400-reject legitimate uploads
      // (especially from iOS/macOS clients with long auto-generated names).
      // Client-supplied labels still must satisfy LabelSchema.
      let validatedLabel: string;
      if (label !== undefined) {
        const parsed = LabelSchema.safeParse(label);
        if (!parsed.success) {
          fail(new UploadError(400, `label invalid: ${parsed.error.message}`));
          return;
        }
        validatedLabel = parsed.data;
      } else {
        validatedLabel = (filename ?? "upload").slice(0, 200);
      }
      // CR-01: await the per-file pipeline before resolving so the temp
      // file is fully flushed to disk by the time the route hashes it.
      const capturedFilename = filename!;
      const capturedTempPath = tempPath!;
      const finalLabel = validatedLabel;
      (writePromise ?? Promise.resolve())
        .then(() => {
          if (settled) return;
          settled = true;
          resolve({
            filename: capturedFilename,
            tempPath: capturedTempPath,
            sizeBytes,
            label: finalLabel,
          });
        })
        .catch((err) => fail(err as Error));
    });

    req.on("error", (err) => fail(err));
    req.pipe(bb);
  });
}

export function registerUpload(app: Hono): void {
  app.post("/api/upload", async (c: Context) => {
    const env = c.env as { incoming?: IncomingMessage };
    const incoming = env?.incoming;
    if (!incoming) {
      return c.json(
        { error: "server misconfigured: no raw IncomingMessage available" },
        500,
      );
    }

    let parsed: ParsedUpload;
    try {
      parsed = await streamMultipart(incoming);
    } catch (err) {
      if (err instanceof UploadError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: `upload failed: ${(err as Error).message}` }, 400);
    }

    const id = newId();
    const createdAt = new Date().toISOString();
    const sourceIp = resolveSourceIp(c);
    const dataDir = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");

    try {
      const sha256Hex = await sha256OfFile(parsed.tempPath);
      // D-09 + D-12: requestTimestampWithFallback iterates DFN → FreeTSA →
      // DigiCert, runs openssl ts -verify against each provider's committed
      // CA chain BEFORE accepting, and returns the full chain attempted.
      // If every provider fails it throws AllTsasFailed.
      const tsa = await requestTimestampWithFallback(sha256Hex);
      const metadata = buildMetadata({
        id,
        originalFilename: parsed.filename,
        sizeBytes: parsed.sizeBytes,
        sha256Hex,
        createdAt,
        label: parsed.label,
        sourceIp,
        tsaProvider: tsa.provider,
        tsaAttestedAt: tsa.attestedAt,
        tsaFallbackChain: tsa.fallbackChain,
      });

      const bundlePath = await writeBundle({
        id,
        original: { filename: parsed.filename, sourcePath: parsed.tempPath },
        sha256Hex,
        tsa: {
          provider: tsa.provider,
          tsq: tsa.tsq,
          tsr: tsa.tsr,
          attestedAt: tsa.attestedAt,
        },
        metadata,
        caCertPath: tsa.caCertPath, // D-10: provider-matched CA chain
        dataDir,
      });

      return c.json({ id, bundle_path: bundlePath }, 201);
    } catch (err) {
      // D-05: never leave a partial bundle. writeBundle handles its own tmp
      // cleanup; we still need to unlink the upload's temp file if it was
      // not yet moved into the bundle.
      await fsp.unlink(parsed.tempPath).catch(() => {});
      if (err instanceof AllTsasFailed) {
        return c.json({ error: "all_tsas_failed", chain: err.chain }, 502);
      }
      const msg = (err as Error).message || "unknown error";
      return c.json({ error: msg }, 502);
    }
  });
}
