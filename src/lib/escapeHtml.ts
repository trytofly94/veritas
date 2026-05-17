/**
 * Attribute-safe HTML escape used by every server-rendered view.
 *
 * Encodes the five characters that have special meaning in either text or
 * attribute contexts:
 *   &  → &amp;   (must come first so subsequent replacements don't double-encode)
 *   <  → &lt;
 *   >  → &gt;
 *   "  → &quot;
 *   '  → &#39;
 *
 * The same escaped string is safe for both element text and `title="…"` /
 * `data-…="…"` attribute values because attribute-safe escaping is a strict
 * superset of text-context escaping.
 */
export function escapeHtml(s: string): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
