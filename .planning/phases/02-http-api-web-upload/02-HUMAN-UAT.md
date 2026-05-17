---
status: partial
phase: 02-http-api-web-upload
source: [02-VERIFICATION.md]
started: 2026-05-17T16:36:57Z
updated: 2026-05-17T16:36:57Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Browser drag-drop upload with progress bar
expected: Open `/` in a browser, drag a file onto the drop zone. Progress bar animates, confirmation panel shows archive ID (with copy button), TSA provider, timestamp, and download link. Verifies Alpine.js XHR progress events, state machine transitions, clipboard API, drag-drop events.
result: [pending]

### 2. Login page visual error state and cookie DevTools attributes
expected: Submit wrong password at `/login` → "Falsches Passwort." error message visible, no cookie. Submit correct password → redirect to `/`, session cookie with HttpOnly/Secure/SameSite=Lax visible in DevTools. Verifies HttpOnly attribute (not readable by JS) and visual error rendering.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
