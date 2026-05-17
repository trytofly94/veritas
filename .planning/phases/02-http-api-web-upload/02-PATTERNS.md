# Phase 2: HTTP API + Web Upload — Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 22 new/modified
**Analogs found:** 18 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/server.ts` (MODIFY) | Hono app factory | request-response | self (existing) | self |
| `src/index.ts` (MODIFY) | bootstrap | startup | self (existing) | self |
| `src/middleware/apiKey.ts` (NEW) | middleware | request-response | `src/lib/sourceIp.ts` | role-match |
| `src/middleware/session.ts` (NEW) | middleware | request-response | `src/lib/sourceIp.ts` | role-match |
| `src/middleware/authOrApiKey.ts` (NEW) | middleware | request-response | `src/lib/sourceIp.ts` | role-match |
| `src/middleware/errorEnvelope.ts` (NEW) | middleware | request-response | `src/routes/upload.ts` (ad-hoc → standardized) | divergence |
| `src/routes/upload.ts` (MODIFY) | route handler | streaming + CRUD | self (existing) | self |
| `src/routes/login.ts` (NEW) | route handler | request-response (form POST) | `src/routes/upload.ts` | role-match |
| `src/routes/download.ts` (NEW) | route handler | streaming (ZIP out) | `src/routes/upload.ts` | role-match |
| `src/routes/pages.ts` (NEW) | route handler | request-response (HTML) | `src/server.ts` (`app.get("/health")`) | role-match |
| `src/lib/config.ts` (NEW) | startup config / env validation | startup | `src/lib/tsaProviders.ts` (env read pattern) | role-match |
| `src/lib/slug.ts` (NEW) | utility | transform | `src/lib/hash.ts` | role-match (pure fn) |
| `src/lib/sessionCookie.ts` (NEW) | utility | transform (HMAC sign/verify) | `src/lib/hash.ts` | role-match |
| `src/lib/zipBundle.ts` (NEW) | utility | streaming I/O | `src/lib/bundle.ts` | role-match |
| `src/lib/verifyTemplate.ts` (NEW) | utility | transform (template substitution) | `src/lib/metadata.ts` | role-match |
| `src/db/schema.ts` (NEW) | drizzle schema | data definition | `src/types.ts` | role-match |
| `src/db/client.ts` (NEW) | db client factory | startup | `src/lib/tsaProviders.ts` | role-match |
| `src/db/migrations/0000_init.sql` (NEW) | migration | schema | (none) | no analog |
| `src/db/backfill.ts` (NEW) | startup task | batch (fs scan + DB insert) | `src/lib/bundle.ts` (fs scan) + `src/lib/metadata.ts` | role-match |
| `src/views/upload.ts` (NEW) | view template | transform (string → HTML) | `src/lib/metadata.ts` | role-match |
| `src/views/login.ts` (NEW) | view template | transform (string → HTML) | `src/lib/metadata.ts` | role-match |
| `src/static/style.css` (NEW) | static asset | file I/O (served) | (none) | no analog |
| `src/static/alpine.min.js` (NEW, vendored) | static asset | file I/O (served) | (none) | no analog |
| `src/static/upload.js` (NEW) | static asset (Alpine component) | file I/O (served) | (none) | no analog |
| `assets/verify-template.md` (NEW) | template asset | substitution | `assets/verify-template.sh` | role-match |
| `tests/unit/slug.test.ts` (NEW) | test | request-response | `tests/unit/tsa.fallback.test.ts` | role-match |
| `tests/unit/sessionCookie.test.ts` (NEW) | test | request-response | `tests/unit/tsa.fallback.test.ts` | role-match |
| `tests/e2e/auth.test.ts` (NEW) | test | request-response | `tests/e2e/upload.happy-path.test.ts` | exact |
| `tests/e2e/download.test.ts` (NEW) | test | streaming | `tests/e2e/upload.happy-path.test.ts` | exact |
| `tests/e2e/login.test.ts` (NEW) | test | request-response | `tests/e2e/upload.happy-path.test.ts` | exact |
| `tests/e2e/backfill.test.ts` (NEW) | test | batch | `tests/e2e/upload.happy-path.test.ts` | role-match |

---

## Pattern Assignments

### `src/server.ts` (MODIFY — Hono factory)

**Analog:** self (`src/server.ts` current)

**Current shape (lines 1-23):**

```typescript
import { Hono } from "hono";
import { registerUpload } from "./routes/upload.js";

let warned = false;

export function createApp(): Hono {
  if (!warned) {
    warned = true;
    console.warn(
      "⚠ Phase 1 has no auth — DO NOT expose port 3000 to the public internet",
    );
  }
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  registerUpload(app);
  return app;
}
```

**Phase 2 changes:**
- **D-26:** Remove the Phase-1 warning. Replace with a one-line log confirming auth active (e.g. `console.info("auto-archive ready (auth active)")`).
- Pass a `Deps` bag (db client, config) into `createApp(deps)` so routes can read them off Hono variables. Drives testability for backfill + DB-dependent endpoints.
- Mount new registrars in this order: `registerErrorEnvelope(app)` (D-23 global) → `registerPages(app)` → `registerLogin(app)` → `registerStatic(app)` → `registerUpload(app, deps)` → `registerDownload(app, deps)`.
- Use `serveStatic` from `@hono/node-server/serve-static` for `/static/*`.

**Divergence vs Phase 1:** Phase 1's `createApp()` takes no args. Phase 2 introduces `createApp(deps: AppDeps)` to inject DB + config. Tests construct `deps` from a tmp SQLite + tmp DATA_DIR.

---

### `src/index.ts` (MODIFY — bootstrap)

**Analog:** self.

**Current shape:**

```typescript
import { serve } from "@hono/node-server";
import { createApp } from "./server.js";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`auto-archive listening on http://0.0.0.0:${info.port}`);
});
```

**Phase 2 additions:**
1. Call `loadConfig()` (from `src/lib/config.ts`) — fails fast if `API_KEY`/`SESSION_SECRET`/`ADMIN_PASSWORD` missing (D-06).
2. Open DB via `openDb(config.manifestDbPath)`, run migrations.
3. Call `backfillManifest({ db, dataDir })` synchronously — must complete before `serve(...)` is called (D-20).
4. Then `createApp({ db, config })` and bind port.

Process exits via `console.error(...) + process.exit(1)` on any startup failure — matches the existing terse style.

---

### `src/middleware/apiKey.ts` (NEW — middleware)

**Analog:** `src/lib/sourceIp.ts` (only existing per-request helper that reads `c.req` headers).

**Imports pattern (from sourceIp.ts lines 1):**

```typescript
import type { Context, MiddlewareHandler } from "hono";
```

**Core pattern — Hono middleware factory returning a handler:**

```typescript
// New code shape (no exact analog; pattern taken from Hono docs).
import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "./errorEnvelope.js";

export function apiKeyMiddleware(expected: string): MiddlewareHandler {
  // Pre-encode once; timingSafeEqual requires equal-length buffers.
  const expectedBuf = Buffer.from(expected, "utf8");
  return async (c, next) => {
    const provided = c.req.header("x-api-key") ?? "";
    const providedBuf = Buffer.from(provided, "utf8");
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return errorResponse(c, 401, "UNAUTHORIZED", "Nicht authentifiziert.");
    }
    await next();
  };
}
```

**Note:** `expected` is injected via the deps bag, NOT read from `process.env` here (config is loaded once in `index.ts` per D-06).

---

### `src/middleware/session.ts` (NEW — middleware)

**Analog:** `src/lib/sourceIp.ts` (Context reader)

**Pattern — read signed cookie, verify HMAC, expose `c.set("session", …)`:**

Reuses `verifySessionCookie()` from `src/lib/sessionCookie.ts`. On verify failure → 401 envelope (for API routes) or redirect to `/login?next=...` (for HTML routes — planner picks based on `c.req.path` prefix, or split into two middlewares: `requireSessionApi` vs `requireSessionPage`).

---

### `src/middleware/authOrApiKey.ts` (NEW — middleware)

**D-12** download endpoint accepts EITHER header. Compose: check `X-API-Key` first (timing-safe), if absent or wrong, fall through to session-cookie check, if neither → 401 envelope.

---

### `src/middleware/errorEnvelope.ts` (NEW — middleware + helper)

**Analog (divergence):** `src/routes/upload.ts` lines 181-184:

```typescript
if (err instanceof UploadError) {
  return c.json({ error: err.message }, err.status);
}
return c.json({ error: `upload failed: ${(err as Error).message}` }, 400);
```

**Phase 2 standardized shape (D-23):**

```typescript
import type { Context, MiddlewareHandler } from "hono";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FILE_TOO_LARGE"
  | "INVALID_REQUEST"
  | "TSA_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ErrorBody {
  error: true;
  code: ErrorCode;
  message: string; // German
}

export function errorResponse(
  c: Context,
  status: 400 | 401 | 404 | 413 | 500 | 502,
  code: ErrorCode,
  message: string,
): Response {
  return c.json<ErrorBody>({ error: true, code, message }, status);
}

/** Global onError + notFound binder. */
export function registerErrorEnvelope(app: Hono): void {
  app.notFound((c) => errorResponse(c, 404, "NOT_FOUND", "Nicht gefunden."));
  app.onError((err, c) => {
    console.error("[error]", err);
    return errorResponse(c, 500, "INTERNAL_ERROR", "Unbekannter Fehler.");
  });
}
```

**Divergence note for planner:** Phase 1's `{error: string}` (single-key) is REPLACED — but the existing upload route returns those shapes today. Phase 2 must update the existing throw sites in `src/routes/upload.ts` to use `errorResponse(...)` so the contract is uniform across `/api/*`. Update the legacy `{error: "all_tsas_failed", chain: [...]}` → `errorResponse(c, 502, "TSA_UNAVAILABLE", "Zeitstempel-Dienst nicht erreichbar. Bitte in einigen Minuten erneut versuchen.")` (chain detail moves to a logged line, not the response body — keeps the public envelope narrow).

---

### `src/routes/upload.ts` (MODIFY)

**Analog:** self.

**Modifications:**
1. Wrap registration with API-key middleware: `app.post("/api/upload", apiKeyMiddleware(deps.config.apiKey), handler)`.
2. Replace ad-hoc `c.json({error: ...}, status)` calls with `errorResponse(...)` (D-23).
3. After `writeBundle(...)` returns, **INSERT row into `archive_entries`** within try/finally per D-21:

```typescript
const bundlePath = await writeBundle({ /* ... */ });
try {
  deps.db.insert(archiveEntries).values({ ...metadata, bundle_dir: bundlePath }).run();
} catch (err) {
  // D-21: orphan handling — log, do NOT delete the bundle (backfill recovers).
  console.error("[upload] DB insert failed for", id, "bundle stays on disk", err);
  return errorResponse(c, 500, "INTERNAL_ERROR", "Unbekannter Fehler.");
}
return c.json({ id, bundle_path: bundlePath }, 201);
```

4. Busboy `limit` event already wired (existing lines 99-103, 121-123) — keep, but emit standardized envelope:

Current (lines 121-123):

```typescript
if (truncated) {
  fail(new UploadError(413, `upload exceeds ${MAX_BODY_BYTES} byte limit`));
  return;
}
```

New (route-level translation): when `UploadError.status === 413` → `errorResponse(c, 413, "FILE_TOO_LARGE", "Datei zu groß. Maximale Größe: 100 MB.")`.

5. Read `MAX_UPLOAD_BYTES` from config (D-25) instead of the hard-coded `100 * 1024 * 1024` constant.

---

### `src/routes/login.ts` (NEW — login + logout)

**Analog:** `src/routes/upload.ts` (Hono register pattern + body parsing)

**Core pattern — form-encoded POST handler:**

```typescript
import type { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { signSessionCookie } from "../lib/sessionCookie.js";
import { renderLoginPage } from "../views/login.js";

export function registerLogin(app: Hono, deps: AppDeps): void {
  app.get("/login", (c) => {
    const error = c.req.query("error") === "1";
    return c.html(renderLoginPage({ error }));
  });

  app.post("/login", async (c) => {
    const body = await c.req.parseBody(); // Hono built-in form parser
    const password = String(body.password ?? "");
    const expected = deps.config.adminPassword;
    const a = Buffer.from(password, "utf8");
    const b = Buffer.from(expected, "utf8");
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      // D-04: re-render with ?error=1 (UI-SPEC accepts either inline render or redirect)
      return c.redirect("/login?error=1", 303);
    }
    const cookie = signSessionCookie(
      { user: "admin", iat: Date.now(), exp: Date.now() + 7 * 24 * 3600 * 1000 },
      deps.config.sessionSecret,
    );
    c.header("Set-Cookie", `session=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/`);
    const next = c.req.query("next");
    return c.redirect(isSafeNext(next) ? next : "/", 303);
  });

  app.post("/logout", (c) => {
    c.header("Set-Cookie", `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    return c.redirect("/login", 303);
  });
}
```

`isSafeNext` rejects anything not starting with `/` or containing `//`/`\\` — narrow allowlist.

---

### `src/routes/download.ts` (NEW — ZIP streaming)

**Analog:** `src/routes/upload.ts` (route registration + error handling) + `src/lib/bundle.ts` (fs reads).

**Pattern — stream ZIP via `archiver` (D-15):**

```typescript
import type { Hono } from "hono";
import archiver from "archiver";
import { Readable } from "node:stream";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { archiveEntries } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { slugifyLabel } from "../lib/slug.js";
import { renderVerifyMd } from "../lib/verifyTemplate.js";
import { errorResponse } from "../middleware/errorEnvelope.js";

export function registerDownload(app: Hono, deps: AppDeps): void {
  app.get("/api/download/:id", authOrApiKey(deps), async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
      return errorResponse(c, 404, "NOT_FOUND", "Archiv nicht gefunden.");
    }
    const row = deps.db
      .select()
      .from(archiveEntries)
      .where(eq(archiveEntries.id, id))
      .get();
    if (!row) return errorResponse(c, 404, "NOT_FOUND", "Archiv nicht gefunden.");

    const meta = JSON.parse(
      await fsp.readFile(path.join(row.bundle_dir, "metadata.json"), "utf8"),
    );
    const slug = slugifyLabel(row.label);
    const filename = `${slug}-${id}.zip`;

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    c.header("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 9 } });
    // D-14: explicit per-file adds (no globbing). Adjust original ext from meta.
    const ext = path.extname(meta.original_filename);
    archive.file(path.join(row.bundle_dir, `original${ext}`), { name: `original${ext}` });
    archive.file(path.join(row.bundle_dir, "original.sha256"), { name: "original.sha256" });
    archive.file(path.join(row.bundle_dir, "original.tsq"), { name: "original.tsq" });
    archive.file(path.join(row.bundle_dir, "original.tsr"), { name: "original.tsr" });
    archive.file(path.join(row.bundle_dir, "tsa-cacert.pem"), { name: "tsa-cacert.pem" });
    archive.file(path.join(row.bundle_dir, "metadata.json"), { name: "metadata.json" });
    archive.file(path.join(row.bundle_dir, "verify.sh"), { name: "verify.sh" });
    archive.append(renderVerifyMd(meta), { name: "VERIFY.md" });
    archive.finalize();

    return new Response(Readable.toWeb(archive) as ReadableStream, {
      headers: c.res.headers,
    });
  });
}
```

**Streaming detail (D-15):** no `Content-Length`; `Cache-Control: no-store`; `archiver` writes into a Node Readable that we adapt to a Web ReadableStream for Hono's Response.

---

### `src/routes/pages.ts` (NEW — `/` HTML + static)

**Analog:** `src/server.ts` `app.get("/health", (c) => c.json({ok:true}))` — the simple GET-returns-payload pattern.

```typescript
export function registerPages(app: Hono, deps: AppDeps): void {
  app.get("/", (c) => c.html(renderUploadPage({ apiKey: deps.config.apiKey })));
}
```

**D-11 note:** `apiKey` is rendered into the page (acceptable per the documented trade-off). No session gate in v1 unless planner takes the alternative path flagged in CONTEXT.md.

---

### `src/lib/config.ts` (NEW — env validation, fail-fast)

**Analog:** `src/lib/tsaProviders.ts` (env-read with defaults pattern). Also follows the fail-fast spirit of upload.ts UploadError.

**Pattern — single `loadConfig()` reads all required vars, throws if any missing:**

```typescript
export interface AppConfig {
  apiKey: string;
  sessionSecret: string;
  adminPassword: string;
  manifestDbPath: string; // default /data/manifest.sqlite
  dataDir: string;        // existing DATA_DIR
  maxUploadBytes: number; // default 100 MiB
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function loadConfig(): AppConfig {
  const sessionSecret = required("SESSION_SECRET");
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  return {
    apiKey: required("API_KEY"),
    sessionSecret,
    adminPassword: required("ADMIN_PASSWORD"),
    manifestDbPath: process.env.MANIFEST_DB_PATH ?? "/data/manifest.sqlite",
    dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), "data"),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024),
  };
}
```

Called once from `src/index.ts`; failure → log + `process.exit(1)` before `serve(...)`.

---

### `src/lib/slug.ts` (NEW — D-13 slugger)

**Analog:** `src/lib/hash.ts` (pure stateless utility, single exported function).

**Pattern:**

```typescript
const UMLAUT_MAP: Record<string, string> = {
  ä: "ae", ö: "oe", ü: "ue", Ä: "ae", Ö: "oe", Ü: "ue", ß: "ss",
};

export function slugifyLabel(label: string): string {
  const folded = label.replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c);
  const lower = folded.toLowerCase();
  const dashed = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const trimmed = dashed.slice(0, 60);
  return trimmed.length > 0 ? trimmed : "archive";
}
```

---

### `src/lib/sessionCookie.ts` (NEW — HMAC sign/verify)

**Analog:** `src/lib/hash.ts` (uses `node:crypto`, pure functions, returns hex).

**Pattern:**

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
  user: "admin";
  iat: number;
  exp: number;
}

export function signSessionCookie(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySessionCookie(
  cookie: string,
  secret: string,
): SessionPayload | null {
  const [body, mac] = cookie.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
```

---

### `src/lib/verifyTemplate.ts` (NEW — VERIFY.md substitution)

**Analog:** `src/lib/metadata.ts` (pure builder over an input object, returns serialized value).

**Pattern — load `assets/verify-template.md` once at module init, expose `renderVerifyMd(meta)` that replaces `{{var}}` tokens.** Uses the `REPO_ROOT` import.meta.url trick from `src/lib/bundle.ts` lines 14-18 / `src/lib/tsa.ts` lines 21-24:

```typescript
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const TEMPLATE_PATH = path.resolve(REPO_ROOT, "assets/verify-template.md");
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, "utf8");

export function renderVerifyMd(meta: Metadata): string {
  return TEMPLATE
    .replaceAll("{{id}}", meta.id)
    .replaceAll("{{original_filename}}", meta.original_filename)
    .replaceAll("{{sha256}}", meta.sha256)
    .replaceAll("{{tsa_provider}}", meta.tsa_provider)
    .replaceAll("{{tsa_attested_at}}", meta.tsa_attested_at);
}
```

---

### `src/db/schema.ts` (NEW — Drizzle table)

**Analog:** `src/types.ts` (data shape canonical definition).

**Pattern — Drizzle SQLite schema mirroring D-19:**

```typescript
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const archiveEntries = sqliteTable(
  "archive_entries",
  {
    id: text("id").primaryKey(),
    original_filename: text("original_filename").notNull(),
    mime_type: text("mime_type").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    created_at: text("created_at").notNull(),
    label: text("label").notNull(),
    source_ip: text("source_ip").notNull(),
    tsa_provider: text("tsa_provider").notNull(),
    tsa_status: text("tsa_status").notNull(),
    tsa_attested_at: text("tsa_attested_at").notNull(),
    tsa_fallback_chain: text("tsa_fallback_chain").notNull(), // JSON-encoded array
    bundle_dir: text("bundle_dir").notNull(),
  },
  (t) => ({
    createdAtIdx: index("idx_archive_entries_created_at").on(t.created_at),
    sha256Idx: index("idx_archive_entries_sha256").on(t.sha256),
  }),
);
```

`tsa_fallback_chain` stored as `JSON.stringify(meta.tsa_fallback_chain)` on insert, parsed on read.

---

### `src/db/client.ts` (NEW — DB factory)

**Analog:** `src/lib/tsaProviders.ts` (config-driven factory pattern).

**Pattern:**

```typescript
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export type Db = BetterSQLite3Database;

export function openDb(dbPath: string): Db {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: path.resolve(REPO_ROOT, "src/db/migrations") });
  return db;
}
```

---

### `src/db/backfill.ts` (NEW — startup scan)

**Analog:** `src/lib/bundle.ts` (`fsp.readdir` + path manipulation) + `src/lib/metadata.ts` (Metadata shape).

**Pattern (D-20):**

```typescript
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { archiveEntries } from "./schema.js";

export async function backfillManifest(args: { db: Db; dataDir: string }): Promise<{ indexed: number; skipped: number }> {
  const t0 = Date.now();
  const entries = await fsp.readdir(args.dataDir, { withFileTypes: true });
  let indexed = 0;
  let skipped = 0;
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".tmp-")) continue;
    const bundleDir = path.join(args.dataDir, ent.name);
    const metaPath = path.join(bundleDir, "metadata.json");
    try {
      const meta = JSON.parse(await fsp.readFile(metaPath, "utf8")) as Metadata;
      args.db
        .insert(archiveEntries)
        .values({
          ...meta,
          tsa_fallback_chain: JSON.stringify(meta.tsa_fallback_chain),
          bundle_dir: bundleDir,
        })
        .onConflictDoNothing() // INSERT OR IGNORE per D-20
        .run();
      indexed++;
    } catch (err) {
      console.warn(`[backfill] skip ${bundleDir}: ${(err as Error).message}`);
      skipped++;
    }
  }
  console.info(`[backfill] indexed ${indexed} entries, skipped ${skipped} broken bundles in ${Date.now() - t0}ms`);
  return { indexed, skipped };
}
```

(Log line format matches the format prescribed in CONTEXT `<specifics>`.)

---

### `src/views/upload.ts` and `src/views/login.ts` (NEW)

**Analog:** `src/lib/metadata.ts` (pure builder, takes input, returns serialized string).

**Pattern — template literal returning full HTML, no engine.** All copy strings from UI-SPEC §"Copywriting Contract". HTML structure matches UI-SPEC §"Component Inventory". CSS lives in `/static/style.css`; Alpine in `/static/alpine.min.js`; component code in `/static/upload.js`.

Example skeleton (upload page injects `apiKey` literal per D-11):

```typescript
export function renderUploadPage(args: { apiKey: string }): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>auto-archive</title>
  <link rel="stylesheet" href="/static/style.css">
  <script defer src="/static/alpine.min.js"></script>
  <script defer src="/static/upload.js"></script>
</head>
<body>
  <main class="page" x-data="uploadForm(${JSON.stringify(args.apiKey)})">
    <!-- ... per UI-SPEC component inventory ... -->
  </main>
</body>
</html>`;
}
```

**Note on D-11 leak risk:** `apiKey` is JSON-encoded into the page. Only render this page over an authenticated/trusted transport (Cloudflare Tunnel + Caddy).

---

### `assets/verify-template.md` (NEW)

**Analog:** `assets/verify-template.sh` (existing committed asset, copied into each bundle by `bundle.ts`).

**Pattern:** plain UTF-8 Markdown with `{{var}}` placeholders, four sections per D-16: "Was ist das?", "Wie prüfen", "Rechtlicher Rahmen", "TSA-Vertrauensquelle". All German. Must include the load-bearing sentence from CONTEXT `<specifics>`: *"Diese Datei beweist, dass die Originaldatei zum angegebenen Zeitpunkt unverändert existiert hat — sie beweist nicht die Urheberschaft."*

---

### Tests

**Analog:** `tests/e2e/upload.happy-path.test.ts` (lines 1-50 are the canonical e2e harness).

**Canonical harness pattern (reuse verbatim for all new e2e tests):**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import { createApp } from "../../src/server.js";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

let server: ReturnType<typeof serve>;
let baseUrl: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "auto-archive-e2e-"));
  process.env.DATA_DIR = dataDir;
  process.env.API_KEY = "test-api-key-1234567890";
  process.env.SESSION_SECRET = "test-session-secret-must-be-32+-bytes-long-yo";
  process.env.ADMIN_PASSWORD = "test-pass";
  process.env.MANIFEST_DB_PATH = path.join(dataDir, "manifest.sqlite");
  const app = createApp(/* deps loaded from env above */);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  await fsp.rm(dataDir, { recursive: true, force: true });
});
```

**Unit tests** (slug, sessionCookie) follow `tests/unit/tsa.fallback.test.ts` env-reset pattern (lines 14-39).

---

## Shared Patterns

### ESM imports with `.js` extension

**Source:** every `src/**/*.ts` file (e.g. `src/server.ts:2` `from "./routes/upload.js"`).

**Apply to:** every new `.ts` file. Imports of sibling/local modules MUST end in `.js` even though the source is `.ts` — required by `module: NodeNext` (`tsconfig.json:3`) + `"type": "module"` (`package.json:5`).

### `node:`-prefixed core imports

**Source:** `src/routes/upload.ts:4-9`, `src/lib/bundle.ts:1-5`.

```typescript
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
```

**Apply to:** all new files using core modules.

### `REPO_ROOT` via `import.meta.url`

**Source:** `src/lib/bundle.ts:14-18`, `src/lib/tsa.ts:21-24`.

```typescript
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
```

**Apply to:** `src/lib/verifyTemplate.ts`, `src/db/client.ts` (locating `assets/verify-template.md` and `src/db/migrations/`). Justified by WR-05 comment in bundle.ts.

### Timing-safe comparison

**Source:** `node:crypto.timingSafeEqual`. Standard for credential checks.

**Apply to:** `src/middleware/apiKey.ts`, `src/routes/login.ts`, `src/lib/sessionCookie.ts`. Always wrap user input + expected in equal-length `Buffer`s before comparing; short-circuit on length mismatch.

### Error envelope (replaces Phase 1 ad-hoc shape)

**Source (target):** `src/middleware/errorEnvelope.ts` (D-23).

**Apply to:** every `/api/*` non-2xx response, plus `notFound` and `onError` global hooks. This is a **divergence** from Phase 1 — `src/routes/upload.ts` lines 171-184, 233-237 currently emit `{error: string}` and must be migrated.

### Deps injection bag

**Source (new convention):** `createApp(deps: { db: Db; config: AppConfig }): Hono`.

**Apply to:** every route registrar — `registerUpload(app, deps)`, `registerDownload(app, deps)`, `registerLogin(app, deps)`, `registerPages(app, deps)`. Phase 1's no-arg `createApp()` is a strict superset under this change (tests gain control over DB + config).

### Vitest harness (real Hono server on port 0)

**Source:** `tests/e2e/upload.happy-path.test.ts:21-49`. Real HTTP, ephemeral port, tmp DATA_DIR via `fsp.mkdtemp`.

**Apply to:** every new e2e test. Always extend `beforeAll` to also set `API_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `MANIFEST_DB_PATH` (in tmp), since Phase 2's `loadConfig()` will throw without them (D-06).

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `src/db/migrations/0000_init.sql` | SQL migration | First migration in repo |
| `src/static/style.css` | hand-authored CSS | No frontend yet |
| `src/static/alpine.min.js` | vendored library | First static asset (other than `assets/verify-template.sh`, which is server-internal) |
| `src/static/upload.js` | Alpine component | First client-side JS |

For these the planner should follow RESEARCH.md / UI-SPEC.md directly (UI-SPEC gives exact component shapes, copy, palette, and spacing).

---

## Metadata

**Analog search scope:** `src/`, `tests/`, `assets/`
**Files scanned:** 18 (full read: server.ts, index.ts, routes/upload.ts, lib/{bundle,metadata,sourceIp,tsa,hash,ids}.ts, types.ts, tests/e2e/upload.happy-path.test.ts, tests/unit/tsa.fallback.test.ts head, tsconfig.json, package.json, docker-compose.yml)
**Pattern extraction date:** 2026-05-17

---

## PATTERN MAPPING COMPLETE
