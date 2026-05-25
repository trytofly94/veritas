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
import type { AppDeps } from "../server.js";
import { apiKeyMiddleware } from "../middleware/apiKey.js";
import { errorResponse } from "../middleware/errorEnvelope.js";
import { archiveEntries } from "../db/schema.js";

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
 *
 * D-25: maxBodyBytes is passed in from deps.config.maxUploadBytes.
 */
function streamMultipart(req: IncomingMessage, maxBodyBytes: number): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    let bb: Busboy.Busboy;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { fileSize: maxBodyBytes, files: 1, fields: 10 },
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
      tempPath = path.join(os.tmpdir(), `veritas-upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

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
        fail(new UploadError(413, `upload exceeds ${maxBodyBytes} byte limit`));
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

export function registerUpload(app: Hono, deps: AppDeps): void {
  // D-25: use config-provided byte limit (not hard-coded constant)
  const MAX_BODY_BYTES = deps.config.maxUploadBytes;

  // D-01: wrap handler with apiKeyMiddleware for timing-safe auth gate
  app.post("/api/upload", apiKeyMiddleware(deps.config.apiKey), async (c: Context) => {
    const env = c.env as { incoming?: IncomingMessage };
    const incoming = env?.incoming;
    if (!incoming) {
      return errorResponse(c, 500, "INTERNAL_ERROR", "Unbekannter Fehler.");
    }

    let parsed: ParsedUpload;
    try {
      parsed = await streamMultipart(incoming, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof UploadError) {
        if (err.status === 413) {
          return errorResponse(c, 413, "FILE_TOO_LARGE", "Datei zu groß. Maximale Größe: 100 MB.");
        }
        return errorResponse(c, 400, "INVALID_REQUEST", "Ungültige Anfrage.");
      }
      return errorResponse(c, 400, "INVALID_REQUEST", "Ungültige Anfrage.");
    }

    const id = newId();
    const createdAt = new Date().toISOString();
    const sourceIp = resolveSourceIp(c);
    const dataDir = deps.config.dataDir;

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

      // D-21: INSERT DB row after bundle is on disk.
      // On INSERT failure: log orphan, emit 500, leave bundle on disk for backfill recovery.
      try {
        deps.db.insert(archiveEntries).values({
          id,
          original_filename: parsed.filename,
          mime_type: metadata.mime_type,
          size_bytes: parsed.sizeBytes,
          sha256: sha256Hex,
          created_at: createdAt,
          label: parsed.label,
          source_ip: sourceIp,
          tsa_provider: tsa.provider,
          tsa_status: "verified",
          tsa_attested_at: tsa.attestedAt,
          tsa_fallback_chain: JSON.stringify(tsa.fallbackChain),
          bundle_dir: bundlePath,
        }).run();
      } catch (dbErr) {
        // D-21: bundle stays on disk for backfill recovery on next boot
        console.error("[upload] DB insert failed for", id, "bundle stays on disk", dbErr);
        return errorResponse(c, 500, "INTERNAL_ERROR", "Unbekannter Fehler.");
      }

      return c.json({ id, bundle_path: bundlePath }, 201);
    } catch (err) {
      // D-05: never leave a partial bundle. writeBundle handles its own tmp
      // cleanup; we still need to unlink the upload's temp file if it was
      // not yet moved into the bundle.
      await fsp.unlink(parsed.tempPath).catch(() => {});
      if (err instanceof AllTsasFailed) {
        // T-02-11: log chain detail server-side only; response body is generic
        console.error("[upload] all TSAs failed", err.chain);
        return errorResponse(c, 502, "TSA_UNAVAILABLE", "Zeitstempel-Dienst nicht erreichbar. Bitte in einigen Minuten erneut versuchen.");
      }
      return errorResponse(c, 500, "INTERNAL_ERROR", "Unbekannter Fehler.");
    }
  });
}
