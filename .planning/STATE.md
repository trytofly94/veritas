# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-16)

**Core value:** Jede archivierte Datei muss kryptografisch beweisbar zum Zeitpunkt der Einreichung existiert haben und unverändert geblieben sein — ohne Abhängigkeit von kostenpflichtigen Drittanbieter-Diensten.
**Current focus:** Phase 1 — Core Archive Engine

## Current Position

Phase: 1 of 3 (Core Archive Engine)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: 2026-05-16 — Roadmap created

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Stack: Node.js 22 LTS + TypeScript + Hono.js + OpenSSL CLI via execFile (NOT PKI.js)
- TSA order: DFN-TSA primary → FreeTSA fallback → DigiCert tertiary
- Storage: Filesystem (ULID directories) + SQLite manifest index; bind-mounted Unraid volumes
- Docker base: node:22-bookworm-slim (NOT Alpine — lacks native module support)

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: Confirm DFN-TSA HTTP endpoint reachability from inside Docker on Unraid before committing as primary
- Phase 1: Validate chattr +i behavior on Unraid XFS; default to chmod 444 regardless
- Phase 2: Integration-test Hono bodyLimit vs Cloudflare edge behavior with >100 MB file before issuing iOS Shortcut credentials

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-05-16
Stopped at: Roadmap created — ready to plan Phase 1
Resume file: None
