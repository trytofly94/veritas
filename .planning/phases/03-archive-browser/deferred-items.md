# Phase 03 — Deferred Items

Pre-existing failures and out-of-scope discoveries surfaced during execution.

## Pre-existing test failures

### `tests/e2e/container-smoke.test.ts` — timeout

- **Found during:** Plan 03-01 verification (`npx vitest run`)
- **Status:** Pre-existing on `master` before this plan started. Confirmed by
  stashing the plan's changes and running the test in isolation — it still
  times out at ~36s without our changes.
- **Symptom:** `scripts/smoke-container.sh` (Docker compose smoke test) takes
  longer than the test's timeout budget. Not a logic failure — purely a
  duration / infrastructure issue.
- **Scope:** Unrelated to Phase 3 (BROWSE-01). Container smoke runs the upload
  pipeline end-to-end in Docker; nothing in this plan touches that path.
- **Action:** Tracked here. Recommend bumping the test timeout or splitting the
  container-smoke check into a separate CI lane.
