---
quick_id: 260518-dqv
date: 2026-05-18
description: Fix Alpine.js script load order on archive-detail page
status: ready
---

# Quick Task 260518-dqv — Fix Alpine.js script load order on archive-detail page

## Context

Milestone v1.0 validation (iter 3) found blocker **B-3**: the in-browser "Integrität prüfen" button on `/archive/:id` is non-functional. Root cause is a script-loading race in `src/views/archive-detail.ts:104-105`:

```html
<script defer src="/static/alpine.min.js"></script>
<script defer src="/static/archive-detail.js"></script>
```

With `defer`, both scripts execute in document order after DOM-ready. Alpine fires `alpine:init` during its own initialization — BEFORE `archive-detail.js` has run its `document.addEventListener("alpine:init", ...)` registration. As a result `Alpine.data('verifyIntegrity', ...)` and `Alpine.data('copyState', ...)` are never registered, the button text is empty, and clicking throws `run is not defined`.

`src/views/upload.ts:27-29` already has the correct ordering (page-specific script BEFORE Alpine) with an explicit comment about the requirement. This task mirrors that pattern.

## Tasks

### Task 1 — Swap script order in archive-detail.ts

**File:** `src/views/archive-detail.ts:104-105`

**Action:** Move `<script defer src="/static/archive-detail.js">` BEFORE `<script defer src="/static/alpine.min.js">`. Add a comment explaining the ordering requirement (mirror upload.ts:27).

**Verify:** Static grep confirms `archive-detail.js` line appears before `alpine.min.js` line in the rendered template.

**Done:** When the unit test from Task 2 passes.

### Task 2 — Add regression test

**File:** `tests/unit/archive-detail-view.test.ts`

**Action:** Add a `describe` block ("B-3 regression — Alpine init race") with a test asserting that, in the rendered HTML, the `<script>` tag for `archive-detail.js` appears at an earlier string index than the one for `alpine.min.js`. This is a static check on the rendered template — sufficient to catch any future reordering regression.

**Verify:** `npx vitest run tests/unit/archive-detail-view.test.ts` passes.

**Done:** Test green; existing 19/19 archive-detail-view tests still pass.

## must_haves

- archive-detail.js script tag loads before alpine.min.js in rendered HTML
- regression test in tests/unit/archive-detail-view.test.ts enforces the ordering
- existing archive-detail-view tests still pass
