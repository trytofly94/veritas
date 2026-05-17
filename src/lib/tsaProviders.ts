import type { TsaProvider } from "../types.js";

export interface TsaProviderConfig {
  id: TsaProvider;
  endpoint: string;
  caCertPath: string;
  timeoutMs: number;
  /**
   * If true, build the TimeStampQuery with `-no_nonce`. Default false — per
   * FreeTSA / CONCERN-2 guidance, nonces should be on by default. Kept as a
   * per-provider escape hatch in case a TSA later requires nonceless queries.
   */
  noNonce: boolean;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Build the TSA provider table at call time (not module-load time) so tests
 * that set TSA_*_ENDPOINT env vars BEFORE invoking the upload pipeline pick
 * the override up. Order is the D-12 fallback order: DFN → FreeTSA → DigiCert.
 */
export function getTsaProviders(): readonly TsaProviderConfig[] {
  const timeoutMs = envNum("TSA_TIMEOUT_MS", 10_000);
  return [
    {
      id: "dfn",
      endpoint: process.env.TSA_DFN_ENDPOINT ?? "https://zeitstempel.dfn.de",
      caCertPath: "assets/tsa-certs/dfn.pem",
      timeoutMs,
      noNonce: false,
    },
    {
      id: "freetsa",
      endpoint: process.env.TSA_FREETSA_ENDPOINT ?? "https://freetsa.org/tsr",
      caCertPath: "assets/tsa-certs/freetsa.pem",
      timeoutMs,
      noNonce: false,
    },
    {
      id: "digicert",
      endpoint:
        process.env.TSA_DIGICERT_ENDPOINT ?? "http://timestamp.digicert.com",
      caCertPath: "assets/tsa-certs/digicert.pem",
      timeoutMs,
      noNonce: false,
    },
  ];
}
