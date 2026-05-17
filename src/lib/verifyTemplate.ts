/**
 * D-16/D-17: VERIFY.md template loader and renderer.
 * Loads assets/verify-template.md once at module init (synchronous).
 * Exports renderVerifyMd(meta) that substitutes {{var}} tokens per-bundle.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Metadata } from "../types.js";

/**
 * WR-05: Resolve module-relative paths instead of cwd-relative ones so
 * the service still works when launched from a different working directory.
 * At runtime this file lives at `dist/lib/verifyTemplate.js`; at dev/test
 * time at `src/lib/verifyTemplate.ts`. Both layouts have the repo root
 * two levels up, where `assets/` is committed.
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const TEMPLATE_PATH = path.resolve(REPO_ROOT, "assets/verify-template.md");

/**
 * Load the template once at module init. Using readFileSync is intentional —
 * the template is a static asset that never changes at runtime. Same pattern
 * as bundle.ts loading verify-template.sh.
 */
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, "utf8");

/**
 * Render the VERIFY.md for a bundle by substituting all five {{var}} tokens.
 * Token set: {{id}}, {{original_filename}}, {{sha256}}, {{tsa_provider}}, {{tsa_attested_at}}
 */
export function renderVerifyMd(meta: Metadata): string {
  return TEMPLATE.replaceAll("{{id}}", meta.id)
    .replaceAll("{{original_filename}}", meta.original_filename)
    .replaceAll("{{sha256}}", meta.sha256)
    .replaceAll("{{tsa_provider}}", meta.tsa_provider)
    .replaceAll("{{tsa_attested_at}}", meta.tsa_attested_at);
}
