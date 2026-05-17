/**
 * Snake-case metadata schema per Phase 1 Plan 01-01 decision D-12.
 * Exactly 12 fields — order is informational only (JSON does not preserve key
 * order semantically, but we serialize in this order for readability).
 */
export interface Metadata {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string; // ISO 8601 UTC
  label: string;
  source_ip: string;
  tsa_provider: TsaProvider;
  tsa_status: "verified";
  tsa_attested_at: string; // ISO 8601 UTC, parsed from TSR genTime
  tsa_fallback_chain: TsaProvider[];
}

export type TsaProvider = "dfn" | "freetsa" | "digicert";

export interface TsaResult {
  provider: TsaProvider;
  tsq: Buffer;
  tsr: Buffer;
  attestedAt: string; // ISO 8601 UTC
}
