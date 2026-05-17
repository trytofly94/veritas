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
import { requestTimestamp } from "../lib/tsa.js";
import { writeBundle } from "../lib/bundle.js";
import { buildMetadata } from "../lib/metadata.js";
import { newId } from "../lib/ids.js";
import { resolveSourceIp } from "../lib/sourceIp.js";

/** Cap any single upload body at 100 MiB (T-01-02). */
const MAX_BODY_BYTES = 100 * 1024 * 1024;

/** Reasonable cap on the optional `label` text. */
const LabelSchema = z.string().max(200);

/** Where the bundled CA chain lives, relative to repo root. */
const DFN_CA_PATH = path.resolve(process.cwd(), "assets/tsa-certs/dfn.pem");

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
      pipeline(fileStream, out).catch((err) => fail(err));
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
      // Validate label
      let validatedLabel = label ?? filename;
      const parsed = LabelSchema.safeParse(validatedLabel);
      if (!parsed.success) {
        fail(new UploadError(400, `label invalid: ${parsed.error.message}`));
        return;
      }
      validatedLabel = parsed.data;
      settled = true;
      resolve({
        filename: filename!,
        tempPath: tempPath!,
        sizeBytes,
        label: validatedLabel,
      });
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
      const tsa = await requestTimestamp(sha256Hex, "dfn");
      const metadata = buildMetadata({
        id,
        originalFilename: parsed.filename,
        sizeBytes: parsed.sizeBytes,
        sha256Hex,
        createdAt,
        label: parsed.label,
        sourceIp,
        tsaProvider: "dfn",
        tsaAttestedAt: tsa.attestedAt,
        tsaFallbackChain: ["dfn"],
      });

      const bundlePath = await writeBundle({
        id,
        original: { filename: parsed.filename, sourcePath: parsed.tempPath },
        sha256Hex,
        tsa,
        metadata,
        caCertPath: DFN_CA_PATH,
        dataDir,
      });

      return c.json({ id, bundle_path: bundlePath }, 201);
    } catch (err) {
      // D-05: never leave a partial bundle. writeBundle handles its own tmp
      // cleanup; we still need to unlink the upload's temp file if it was
      // not yet moved into the bundle.
      await fsp.unlink(parsed.tempPath).catch(() => {});
      const msg = (err as Error).message || "unknown error";
      return c.json({ error: msg }, 502);
    }
  });
}
