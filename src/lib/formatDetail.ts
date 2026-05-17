/**
 * Pure formatters for the Phase 3 archive detail page (BROWSE-02).
 *
 * - formatBytes: Bytes → German-locale humanized size string.
 *     Uses base 1024 (binary kibibytes labeled with decimal-style units, common
 *     UI convention). The fixture values in UI-SPEC and the unit tests confirm
 *     this ladder: 186_777 → "182,4 kB" (186777/1024 = 182.40), 2_200_000 →
 *     "2,1 MB" (2200000/1024² = 2.098), 5_000_000_000 → "4,7 GB"
 *     (5e9/1024³ = 4.656).
 *     - 0..1023 → "{n} B" (no decimals)
 *     - >=1024  → "{x},{d} kB|MB|GB|TB" via Intl.NumberFormat('de-DE') with one
 *       fractional digit (German decimal comma).
 *
 * - truncateSha: Truncate a hex SHA-256 to a 16-char prefix + "…" (HORIZONTAL
 *     ELLIPSIS U+2026). Empty → "—" (em-dash placeholder). Inputs of length
 *     <= 16 are returned as-is.
 *
 * Both functions are pure (no I/O, no Date allocation) and locale-stable —
 * Intl.NumberFormat('de-DE', …) is consistent regardless of host locale.
 */

const FMT = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const UNITS: ReadonlyArray<string> = ["kB", "MB", "GB", "TB"];

/**
 * Format a byte count using German locale conventions.
 *  - 0 .. 999 bytes → "{n} B" (no fractional separator)
 *  - 1 kB and up   → "{de-DE number with one decimal} {unit}"
 *    where unit ∈ {kB, MB, GB, TB} and the ladder is base 1000.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) {
    // No decimals below 1 kB — integer byte count.
    return `${Math.trunc(bytes)} B`;
  }

  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${FMT.format(value)} ${UNITS[unitIndex]}`;
}

/**
 * Truncate a hex SHA-256 (or any hex string) to the first 16 chars + horizontal
 * ellipsis. Empty → em-dash placeholder. Short strings (<=16) are returned
 * untouched so callers can pass already-short values without conditionals.
 */
export function truncateSha(hex: string): string {
  if (!hex) return "—";
  if (hex.length <= 16) return hex;
  return hex.slice(0, 16) + "…";
}
