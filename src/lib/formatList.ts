/**
 * Pure formatters for the Phase 3 archive list page.
 *
 * - formatRowDate: ISO 8601 → "YYYY-MM-DD HH:mm" UTC (no seconds, no TZ suffix).
 *   Invalid input returns the em-dash placeholder "—" per UI-SPEC §Copywriting Contract.
 *
 * - mimeToType: MIME string → uppercase subtype. Special case: text/plain → "TXT".
 *   Empty/null/undefined → "—".
 *
 * - tsaBadgeProps: (provider, status) → { className, label } per UI-SPEC §TSA Status
 *   Badge Color Mapping. Treats "ok" and "verified" as success (Phase 2 manifest
 *   uses "verified" as the success status string).
 *
 * All three functions are pure (no I/O, no Date allocation surprises) and trivially
 * testable.
 */

/**
 * Format an ISO 8601 timestamp as "YYYY-MM-DD HH:mm" in UTC.
 * Slices the canonical ISO string rather than calling toLocaleString to keep the
 * output stable across host locales and timezones (UI-SPEC §Component Inventory #1).
 */
export function formatRowDate(iso: string): string {
  if (!iso || typeof iso !== "string") return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  // toISOString() always returns "YYYY-MM-DDTHH:mm:ss.sssZ" — slice 0..16 then
  // replace the "T" with a space.
  const canonical = new Date(ts).toISOString().slice(0, 16);
  return canonical.replace("T", " ");
}

/**
 * Map a MIME string to a short uppercase "Typ" label.
 *  - "application/pdf"  → "PDF"
 *  - "image/jpeg"       → "JPEG"
 *  - "text/plain"       → "TXT"   (special case — TXT reads better than PLAIN)
 *  - "application/zip"  → "ZIP"
 *  - "", null, undefined → "—"
 */
export function mimeToType(mime: string | null | undefined): string {
  if (!mime) return "—";
  if (mime === "text/plain") return "TXT";
  const slash = mime.indexOf("/");
  if (slash === -1) return mime.toUpperCase();
  const sub = mime.slice(slash + 1);
  if (!sub) return "—";
  return sub.toUpperCase();
}

export interface TsaBadgeProps {
  className: string;
  label: string;
}

/**
 * Resolve the TSA status badge presentation per UI-SPEC §Implementation Notes.
 *
 * Mapping table:
 *  - status ∈ {ok, verified} AND provider == "dfn"            → ok badge,    "DFN"
 *  - status ∈ {ok, verified} AND provider == "freetsa"        → ok badge,    "FreeTSA"
 *  - status ∈ {ok, verified} AND provider == "local-fallback" → local badge, "Lokal"
 *  - status ∈ {ok, verified} AND any other provider           → ok badge,    capitalized provider
 *  - any other status (failed, unknown, missing)              → failed badge, "Fehlgeschlagen"
 *
 * Note: Phase 2 manifest stores tsa_status as "verified" on success; we accept
 * both spellings so callers don't have to normalize beforehand.
 */
export function tsaBadgeProps(provider: string, status: string): TsaBadgeProps {
  const isSuccess = status === "ok" || status === "verified";
  if (!isSuccess) {
    return {
      className: "tsa-badge tsa-badge--failed",
      label: "Fehlgeschlagen",
    };
  }

  switch (provider) {
    case "dfn":
      return { className: "tsa-badge tsa-badge--ok", label: "DFN" };
    case "freetsa":
      return { className: "tsa-badge tsa-badge--ok", label: "FreeTSA" };
    case "local-fallback":
      return { className: "tsa-badge tsa-badge--local", label: "Lokal" };
    default: {
      // Unknown attested provider — capitalize first letter, keep rest as-is.
      const label = provider
        ? provider.charAt(0).toUpperCase() + provider.slice(1)
        : "Fehlgeschlagen";
      return { className: "tsa-badge tsa-badge--ok", label };
    }
  }
}
