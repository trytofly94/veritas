import { lookup as mimeLookup } from "mime-types";
import type { Metadata, TsaProvider } from "../types.js";

export interface BuildMetadataArgs {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  sha256Hex: string;
  createdAt: string; // ISO 8601 UTC
  label: string;
  sourceIp: string;
  tsaProvider: TsaProvider;
  tsaAttestedAt: string;
  tsaFallbackChain: TsaProvider[];
}

/**
 * Build the canonical snake_case Metadata object per D-12. All 12 fields are
 * required; tsa_status is always "verified" in Phase 1 (D-05 invariant — no
 * partial bundles ever land on disk).
 */
export function buildMetadata(args: BuildMetadataArgs): Metadata {
  const mime = mimeLookup(args.originalFilename) || "application/octet-stream";
  return {
    id: args.id,
    original_filename: args.originalFilename,
    mime_type: mime,
    size_bytes: args.sizeBytes,
    sha256: args.sha256Hex,
    created_at: args.createdAt,
    label: args.label,
    source_ip: args.sourceIp,
    tsa_provider: args.tsaProvider,
    tsa_status: "verified",
    tsa_attested_at: args.tsaAttestedAt,
    tsa_fallback_chain: args.tsaFallbackChain,
  };
}
