import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as asn1js from "asn1js";
import { ContentInfo, SignedData } from "pkijs";
import type { TsaProvider, TsaResult } from "../types.js";
import { getTsaProviders, type TsaProviderConfig } from "./tsaProviders.js";
import { verifyTsr } from "./verifyTsr.js";

/**
 * WR-05: Resolve module-relative paths instead of cwd-relative ones, so
 * the service still works when launched from a different working
 * directory (systemd units default to /, process supervisors may chdir,
 * etc.). At runtime this file lives at `dist/lib/tsa.js` and at dev/test
 * time at `src/lib/tsa.ts`; both layouts have the repo root two levels up.
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const execFile = promisify(execFileCb);

/** Thrown when every TSA in the configured fallback chain fails. */
export class AllTsasFailed extends Error {
  /** Providers attempted, in order, that all failed. */
  public readonly chain: TsaProvider[];
  constructor(public attempts: { provider: TsaProvider; error: string }[]) {
    super(
      `All TSAs failed: ${attempts.map((a) => `${a.provider}=${a.error}`).join("; ")}`,
    );
    this.name = "AllTsasFailed";
    this.chain = attempts.map((a) => a.provider);
  }
}

export interface FallbackResult {
  provider: TsaProvider;
  tsq: Buffer;
  tsr: Buffer;
  attestedAt: string;
  /** Providers attempted in order, including the one that succeeded last. */
  fallbackChain: TsaProvider[];
  /** Absolute path to the CA cert chain to copy into the bundle (D-10). */
  caCertPath: string;
}

/**
 * Build an RFC 3161 TimeStampQuery for the given SHA-256 hex digest.
 * Nonces are ON by default (CONCERN-2 / FreeTSA recommendation). The
 * per-provider `noNonce` escape hatch lets future TSAs that require
 * nonceless queries opt out — for v1 every provider keeps the default.
 */
async function buildTimestampQuery(
  sha256Hex: string,
  noNonce: boolean,
): Promise<Buffer> {
  // SECURITY: validate the only attacker-controlled value reaching execFile.
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) {
    throw new Error("buildTimestampQuery: sha256Hex must be 64 lowercase hex chars");
  }
  const args = ["ts", "-query", "-digest", sha256Hex, "-sha256", "-cert"];
  if (noNonce) args.push("-no_nonce");
  const { stdout } = await execFile("openssl", args, {
    encoding: "buffer",
    maxBuffer: 1024 * 1024,
  });
  return Buffer.from(stdout);
}

/**
 * POST a TimeStampQuery to the given TSA endpoint, return the raw TSR.
 * Enforces a per-call AbortController timeout. The timeout path is exercised
 * by tests/unit/tsa.fallback.test.ts (sloth-endpoint scenario), not only by
 * ECONNREFUSED — see the threat model T-02-03 mitigation.
 */
async function postTsq(
  endpoint: string,
  tsq: Buffer,
  timeoutMs: number,
): Promise<Buffer> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      // Coerce Buffer → Uint8Array for fetch BodyInit (Node 22 lib.dom types
      // do not include Buffer in BodyInit). They share the underlying memory.
      body: new Uint8Array(tsq),
      signal: abort.signal,
    });
    if (!res.ok) {
      throw new Error(`TSA returned HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Request a timestamp from a single TSA provider. Returns the parsed result.
 * Does NOT perform openssl ts -verify — the caller (fallback orchestrator)
 * does that against the provider's committed CA chain before accepting.
 */
async function requestTimestampFromProvider(
  sha256Hex: string,
  provider: TsaProviderConfig,
): Promise<TsaResult> {
  const tsq = await buildTimestampQuery(sha256Hex, provider.noNonce);
  const tsr = await postTsq(provider.endpoint, tsq, provider.timeoutMs);
  const attestedAt = parseGenTime(tsr);
  // WR-06: TsaResult carries tsq, tsr, attestedAt, and provider — no
  // need for an Object.assign side channel or downstream type-bypass
  // casts (see fallback orchestrator below).
  return { provider: provider.id, tsq, tsr, attestedAt };
}

/**
 * Iterate the configured TSA providers in priority order (D-12: DFN → FreeTSA
 * → DigiCert). For each provider:
 *   1. Build + POST the ts-query (per-provider timeout)
 *   2. Parse the TSR genTime
 *   3. verifyTsr against the provider's COMMITTED CA chain (D-09)
 * On any failure (network, timeout, parse, verify) record the provider as
 * failed and continue. On first success return the FallbackResult with the
 * full chain of attempted providers. If every provider fails throw
 * AllTsasFailed, whose .chain lets the route surface the failure as a 502
 * with body `{error:"all_tsas_failed", chain:[...]}` while leaving no
 * partial bundle on disk (D-05).
 */
export async function requestTimestampWithFallback(
  sha256Hex: string,
): Promise<FallbackResult> {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) {
    throw new Error(
      "requestTimestampWithFallback: sha256Hex must be 64 lowercase hex chars",
    );
  }

  const providers = getTsaProviders();
  const attempts: { provider: TsaProvider; error: string }[] = [];

  for (const p of providers) {
    let attempt: TsaResult | undefined;
    try {
      attempt = await requestTimestampFromProvider(sha256Hex, p);
    } catch (err) {
      attempts.push({
        provider: p.id,
        error: classifyError(err),
      });
      continue;
    }

    // Pre-finalization verify (D-09). Write the attested data to a temp file
    // so openssl ts -verify -data <file> has something to chew on. We use
    // a temp file because verifyTsr needs the actual original bytes, but at
    // this stage in the pipeline the orchestrator does not have them — so we
    // verify against an ephemeral file containing the digest's preimage IS
    // NOT possible. Instead, we verify against the TSR itself by using
    // openssl ts -verify -queryfile <tsq> -CAfile <ca>, which checks the
    // signature without needing the original data. This is the same path
    // the cert-discovery procedure uses (see assets/tsa-certs/README.md).
    try {
      await verifyTsrAgainstQuery({
        tsq: attempt.tsq,
        tsr: attempt.tsr,
        caCertPath: path.resolve(REPO_ROOT, p.caCertPath),
      });
    } catch (err) {
      attempts.push({
        provider: p.id,
        error: `verify-failed: ${(err as Error).message}`,
      });
      continue;
    }

    return {
      provider: p.id,
      tsq: attempt.tsq,
      tsr: attempt.tsr,
      attestedAt: attempt.attestedAt,
      fallbackChain: [...attempts.map((a) => a.provider), p.id],
      caCertPath: path.resolve(REPO_ROOT, p.caCertPath),
    };
  }

  throw new AllTsasFailed(attempts);
}

/**
 * Verify a TSR's signature against its corresponding TSQ + the committed CA
 * chain. Unlike `verifyTsr` (which checks `tsr` against the original data
 * file), this path verifies the cryptographic signature only and is suitable
 * for the pre-finalization gate where the data file is the streamed upload
 * temp and we want to validate the TSA's authenticity before committing the
 * bundle to disk.
 */
async function verifyTsrAgainstQuery(args: {
  tsq: Buffer;
  tsr: Buffer;
  caCertPath: string;
}): Promise<void> {
  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const tsrPath = path.join(os.tmpdir(), `veritas-prv-${unique}.tsr`);
  const tsqPath = path.join(os.tmpdir(), `veritas-prv-${unique}.tsq`);
  await fsp.writeFile(tsrPath, args.tsr);
  await fsp.writeFile(tsqPath, args.tsq);
  try {
    await execFile(
      "openssl",
      [
        "ts",
        "-verify",
        "-in",
        tsrPath,
        "-queryfile",
        tsqPath,
        "-CAfile",
        args.caCertPath,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(e.stderr?.trim() || e.message);
  } finally {
    await fsp.unlink(tsrPath).catch(() => {});
    await fsp.unlink(tsqPath).catch(() => {});
  }
}

/** Re-export verifyTsr so callers needing the data-path check can use it. */
export { verifyTsr };

/**
 * Reduce an arbitrary thrown value to a short error tag suitable for the
 * AllTsasFailed.attempts log and the timeout-path assertion in tests.
 */
function classifyError(err: unknown): string {
  if (err instanceof Error) {
    // Node 22's fetch wraps the AbortError under `cause`. Normalize.
    const cause = (err as { cause?: { name?: string; message?: string } }).cause;
    if (
      err.name === "AbortError" ||
      cause?.name === "AbortError" ||
      /aborted|signal/i.test(err.message)
    ) {
      return `timeout: ${err.message}`;
    }
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Legacy single-provider API kept for backwards compatibility with Plan 01-01
// tests + any caller that has not yet migrated. Now dispatches through the
// provider table (so TSA_DFN_ENDPOINT env override applies).
// ---------------------------------------------------------------------------

/** Per-TSA outbound HTTP timeout (legacy entry point default). */
const TSA_TIMEOUT_MS = 10_000;

/**
 * Request an RFC 3161 timestamp for a SHA-256 digest from the named TSA.
 * Legacy single-provider entry point. New code should call
 * requestTimestampWithFallback() instead.
 */
export async function requestTimestamp(
  sha256Hex: string,
  provider: TsaProvider = "dfn",
): Promise<TsaResult> {
  const providers = getTsaProviders();
  const p = providers.find((x) => x.id === provider);
  if (!p) {
    throw new Error(`requestTimestamp: unknown provider '${provider}'`);
  }
  const config: TsaProviderConfig = {
    ...p,
    timeoutMs: p.timeoutMs || TSA_TIMEOUT_MS,
  };
  const { tsq, tsr, attestedAt } = await requestTimestampFromProvider(
    sha256Hex,
    config,
  );
  return { provider: p.id, tsq, tsr, attestedAt };
}

/**
 * Parse the `genTime` (TSTInfo.genTime) from an RFC 3161 TimeStampResp.
 *
 * Wire shape:
 *   TimeStampResp := SEQUENCE {
 *     status         PKIStatusInfo,
 *     timeStampToken ContentInfo OPTIONAL
 *   }
 *   timeStampToken.content = SignedData
 *   SignedData.encapContentInfo.eContent = TSTInfo (DER, wrapped in OCTET STRING)
 *   TSTInfo.genTime = GeneralizedTime
 *
 * Returns an ISO 8601 UTC string.
 */
export function parseGenTime(tsr: Buffer): string {
  const ab = new Uint8Array(tsr).buffer;
  const asn1 = asn1js.fromBER(ab);
  if (asn1.offset === -1) {
    throw new Error("TSR is not valid ASN.1 BER");
  }
  const tsrSeq = asn1.result as asn1js.Sequence;
  const values = tsrSeq.valueBlock.value;
  if (values.length < 2) {
    throw new Error("TSR is missing timeStampToken (status-only response?)");
  }
  const tstTokenSchema = values[1]!;
  const ci = new ContentInfo({ schema: tstTokenSchema });
  const sd = new SignedData({ schema: ci.content });

  const eContent = sd.encapContentInfo.eContent;
  if (!eContent) {
    throw new Error("SignedData.encapContentInfo.eContent missing");
  }
  const tstInfoBytes = (eContent.valueBlock as { valueHexView: Uint8Array })
    .valueHexView;
  const tstInfoAsn1 = asn1js.fromBER(new Uint8Array(tstInfoBytes).buffer);
  if (tstInfoAsn1.offset === -1) {
    throw new Error("TSTInfo is not valid ASN.1 BER");
  }
  const tstSeq = tstInfoAsn1.result as asn1js.Sequence;
  const genTimeNode = tstSeq.valueBlock.value[4];
  if (!genTimeNode) {
    throw new Error("TSTInfo.genTime missing");
  }
  const gt = genTimeNode as unknown as { toDate(): Date };
  if (typeof gt.toDate !== "function") {
    throw new Error("TSTInfo.genTime is not a GeneralizedTime");
  }
  return gt.toDate().toISOString();
}
