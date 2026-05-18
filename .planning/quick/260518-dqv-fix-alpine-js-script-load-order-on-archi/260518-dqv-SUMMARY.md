---
quick_id: 260518-dqv
date: 2026-05-18
status: complete
commit: 87beef0
description: Fix Alpine.js script load order on archive-detail page
---

# Quick Task 260518-dqv — Summary

## Outcome

✓ Complete. Closes **B-3** from `.planning/v1.0-MILESTONE-VALIDATION.md` (iter 3) and restores **BROWSE-02 SC-2** ("being able to confirm its integrity" in the browser).

## Changes

- **`src/views/archive-detail.ts:103-106`** — Swapped the two `<script>` tags so `archive-detail.js` loads before `alpine.min.js`. Added an inline comment mirroring the pattern in `src/views/upload.ts:27`.
- **`tests/unit/archive-detail-view.test.ts`** — Added a B-3 regression `describe` block that asserts the script-tag ordering in the rendered HTML (compares string indices of `src="/static/archive-detail.js"` and `src="/static/alpine.min.js"`).

## Verification

- `npx vitest run tests/unit/archive-detail-view.test.ts` → **20/20 pass** (was 19, +1 new regression test)
- Full suite → **171/172 pass**; the 1 failure is `tests/e2e/container-smoke.test.ts` which pre-exists on master (Docker container smoke test, unrelated to this change — confirmed by `git stash && vitest run` on the unchanged tree).

## Commit

`87beef0` — `fix(quick-260518-dqv): swap script load order on archive-detail to unbreak verify button`

## Follow-up

The v1.0 milestone audit (`.planning/v1.0-MILESTONE-AUDIT.md`) was marked `gaps_found` with B-3 as the sole blocker. With this fix in place, a re-run of `/gsd-audit-milestone` (or the equivalent live browser smoke check) should now clear BROWSE-02 and return the milestone to `passed`.
