import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as asn1js from "asn1js";
import { ContentInfo, SignedData } from "pkijs";
import type { TsaProvider, TsaResult } from "../types.js";

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
  /** Absolute path to the CA cert chain to copy into the bundle. */
  caCertPath: string;
}

export async function requestTimestampWithFallback(
  _sha256Hex: string,
): Promise<FallbackResult> {
  throw new Error(
    "requestTimestampWithFallback: not yet implemented (Plan 01-02 RED)",
  );
}

/** Per-TSA outbound HTTP timeout. */
const TSA_TIMEOUT_MS = 10_000;

/** Per-TSA endpoint table. Plan 01-01 only supports DFN. */
const ENDPOINTS: Record<TsaProvider, string> = {
  dfn: "https://zeitstempel.dfn.de",
  freetsa: "https://freetsa.org/tsr",
  digicert: "http://timestamp.digicert.com", // placeholder; Plan 01-02 finalizes
};

/**
 * Request an RFC 3161 timestamp for a SHA-256 digest from the named TSA.
 *
 * Pipeline:
 *  1. `openssl ts -query -digest <hex> -sha256 -cert` (a nonce is included
 *     by default — per FreeTSA recommendation we do not disable the nonce)
 *  2. HTTPS POST the TSQ to the TSA with `Content-Type: application/timestamp-query`
 *  3. Parse the TSR ASN.1 via pkijs and extract the SignedData → TSTInfo →
 *     genTime field. (We never regex the human-readable `openssl ts` reply
 *     output — that path is locale-dependent and fragile.)
 *
 * @throws Error if the digest is malformed, openssl fails, the TSA times
 *   out, returns a non-2xx, or the TSR cannot be parsed.
 */
export async function requestTimestamp(
  sha256Hex: string,
  provider: TsaProvider = "dfn",
): Promise<TsaResult> {
  // SECURITY: validate the only attacker-controlled value reaching execFile.
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) {
    throw new Error("requestTimestamp: sha256Hex must be 64 lowercase hex chars");
  }
  if (provider !== "dfn") {
    // Plan 01-01 supports DFN only. Fallback chain arrives with Plan 01-02.
    throw new Error(`requestTimestamp: provider '${provider}' not supported in Plan 01-01`);
  }

  // Step 1 — build the TimeStampQuery via openssl (binary on stdout).
  // We must capture binary stdout: pass encoding: 'buffer' via maxBuffer override.
  const { stdout: tsq } = await execFile(
    "openssl",
    ["ts", "-query", "-digest", sha256Hex, "-sha256", "-cert"],
    { encoding: "buffer", maxBuffer: 1024 * 1024 },
  );
  const tsqBuf = Buffer.from(tsq);

  // Step 2 — POST to the TSA. AbortController enforces the per-call timeout.
  const endpoint = ENDPOINTS[provider];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TSA_TIMEOUT_MS);
  let tsrBuf: Buffer;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: tsqBuf,
      signal: abort.signal,
    });
    if (!res.ok) {
      throw new Error(`TSA ${provider} returned HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/timestamp-reply")) {
      // Some TSAs are lax about Content-Type; don't hard-fail, but warn in
      // dev. Continue — the ASN.1 parse below will reject garbage.
    }
    const buf = Buffer.from(await res.arrayBuffer());
    tsrBuf = buf;
  } finally {
    clearTimeout(timer);
  }

  // Step 3 — parse genTime out of the TSR via pkijs (CONCERN-1).
  const attestedAt = parseGenTime(tsrBuf);

  return { provider, tsq: tsqBuf, tsr: tsrBuf, attestedAt };
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
  // Copy into a fresh ArrayBuffer to satisfy asn1js's BufferSource type
  // (avoids the SharedArrayBuffer vs ArrayBuffer narrowing issue).
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
  // eContent is an OCTET STRING whose value bytes are the DER encoding of TSTInfo.
  // pkijs exposes the raw bytes via valueBlock.valueHexView.
  const tstInfoBytes = (eContent.valueBlock as { valueHexView: Uint8Array })
    .valueHexView;
  const tstInfoAsn1 = asn1js.fromBER(new Uint8Array(tstInfoBytes).buffer);
  if (tstInfoAsn1.offset === -1) {
    throw new Error("TSTInfo is not valid ASN.1 BER");
  }
  const tstSeq = tstInfoAsn1.result as asn1js.Sequence;
  // TSTInfo := SEQUENCE { version INTEGER, policy OID, messageImprint, serialNumber INTEGER,
  //                       genTime GeneralizedTime, accuracy OPTIONAL, ordering BOOLEAN OPTIONAL,
  //                       nonce INTEGER OPTIONAL, tsa OPTIONAL, extensions OPTIONAL }
  // genTime is the 5th element (index 4).
  const genTimeNode = tstSeq.valueBlock.value[4];
  if (!genTimeNode) {
    throw new Error("TSTInfo.genTime missing");
  }
  // pkijs exposes the parsed Date directly on GeneralizedTime via toDate(),
  // but asn1js's raw GeneralizedTime stores .toDate() too.
  const gt = genTimeNode as unknown as { toDate(): Date };
  if (typeof gt.toDate !== "function") {
    throw new Error("TSTInfo.genTime is not a GeneralizedTime");
  }
  return gt.toDate().toISOString();
}
