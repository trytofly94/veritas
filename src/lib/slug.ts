/**
 * D-13: Slug utility for generating safe ZIP filenames from user-provided labels.
 * Folds German umlauts into ASCII digraphs, lowercases, replaces non-alphanumerics
 * with dashes, trims leading/trailing dashes, caps at 60 chars, falls back to "archive".
 */

const UMLAUT_MAP: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ß: "ss",
};

export function slugifyLabel(label: string): string {
  // Step 1: Replace German umlauts
  const folded = label.replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c);
  // Step 2: Lowercase
  const lower = folded.toLowerCase();
  // Step 3: Replace non-alphanumeric sequences with dashes, trim leading/trailing
  const dashed = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Step 4: Cap at 60 chars
  const trimmed = dashed.slice(0, 60);
  // Step 5: Fallback to "archive" if empty
  return trimmed.length > 0 ? trimmed : "archive";
}
