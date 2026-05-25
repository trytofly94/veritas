# veritas

## Current State

**Shipped:** v1.0 MVP (2026-05-18) — full end-to-end pipeline live on Unraid: HTTP API + web upload, DFN/FreeTSA/DigiCert fallback chain, browser archive viewer with integrity verify, downloadable verifiable ZIP bundle with § 286 ZPO legal framing.

**Stack as built:** Node.js 22 + TypeScript + Hono + Drizzle/SQLite + vendored Alpine.js, served from a hardened `node:22-bookworm-slim` Docker container (read-only rootfs, all caps dropped, uid 10001).

## What This Is

Ein selbst gehostetes System zur automatisierten, gerichtssicheren Archivierung von Dateien aller Art — mit RFC 3161 Zeitstempeln und SHA-256 Integritätsprüfung. Dateien können per iOS Shortcut, n8n-Webhook, curl oder Web-Upload eingereicht werden und landen manipulationssicher auf dem eigenen Unraid-Server. Für Lennart und Familie/kleines Team.

## Core Value

Jede archivierte Datei muss kryptografisch beweisbar zum Zeitpunkt der Einreichung existiert haben und unverändert geblieben sein — ohne Abhängigkeit von kostenpflichtigen Drittanbieter-Diensten.

## Requirements

### Validated

- ✓ Datei-Upload per HTTP-Endpunkt (für iOS Shortcut, n8n, curl) — v1.0
- ✓ Web-Upload-Frontend (erreichbar von überall via Cloudflare Tunnel) — v1.0
- ✓ SHA-256 Hash wird bei Eingang automatisch berechnet — v1.0
- ✓ RFC 3161 Zeitstempel von DFN-TSA / FreeTSA / DigiCert angefordert und gespeichert — v1.0 (Fallback-Kette implementiert)
- ✓ Strukturiertes Archiv pro Datei: original + .sha256 + .tsq + .tsr + metadata.json + verify.sh + tsa-cacert.pem — v1.0
- ✓ Privates Archiv-Browser-Frontend (alle archivierten Einträge anzeigen) — v1.0 (Suche/Filter noch offen)
- ✓ Verifikationsfunktion: Integrität einer Datei nachträglich prüfbar — v1.0 (Browser-Button + verify.sh)
- ✓ Metadaten pro Einreichung: Absender (Label), Zeitpunkt, IP, Notiz — v1.0
- ✓ Einfache Authentifizierung (API-Key für Uploads, HMAC-Session für Browser) — v1.0
- ✓ Download-Bundle: 8-File ZIP mit VERIFY.md (§ 286 ZPO) — v1.0
- ✓ Unterstützung aller Dateitypen — v1.0 (streaming multipart, kein Format-Lock)
- ✓ Docker Container auf Unraid — v1.0 (live-verifiziert auf 192.168.178.30)
- ✓ n8n-Integration: per X-API-Key Webhook — v1.0 (n8n-Setup separat)

### Active

- [ ] Suche/Filter im Archiv-Browser (Filename, Datum, Typ) — verschoben aus v1.0
- [ ] `COOKIE_SECURE` env-var-Gate, damit Login über plain-HTTP LAN funktioniert (`http://192.168.178.30:3000`)
- [ ] `POST /api/upload` 201-Response um `tsa_provider` + `tsa_attested_at` ergänzen (Web-Upload-Success-Card zeigt sonst leere TSA-Zeilen)
- [ ] Runtime-Schema-Validation für `metadata.json` (zod statt `as unknown as` Cast)

### Out of Scope

- Akkreditierte/kostenpflichtige TSA (D-Trust, Bundesdruckerei) — kostenlos-first, kann später manuell ergänzt werden
- MinIO / Object Lock — Dateisystem-Lösung auf Unraid reicht für v1, WORM via chattr+a optional
- Blockchain-Timestamping (OpenTimestamps) — nice-to-have, nicht v1
- WhatsApp-API-Integration (direkter Abruf) — User exportiert manuell und reicht ZIP ein
- Multi-Tenant / externe Nutzer — nur Lennart + Familie/bekannte Personen mit API-Key
- OCR / Inhaltsindexierung — Metasuche nach Dateiinhalt ist out of scope v1

## Context

- Lennart betreibt einen Unraid-Server (192.168.178.30) mit Docker-Containern, Cloudflare Tunnel für externe Erreichbarkeit
- n8n läuft bereits auf dem Unraid-Server
- Caddy-Central als Reverse Proxy mit Authelia-Authentication
- iOS Shortcuts als mobile Einreichungsmethode
- Primärer Anwendungsfall: Vorsorge für potentielle Rechtsstreitigkeiten (Zivilrecht, Arbeitsrecht)
- FreeTSA (freetsa.org) und DFN-TSA (zeitstempel.dfn.de) als kostenlose RFC 3161-konforme Timestamp Authorities
- Dateitypen: WhatsApp ZIP-Exporte, Screenshots, PDFs, beliebige Dateien

## Constraints

- **Budget**: Kostenlos — nur FreeTSA/DFN-TSA (keine kostenpflichtigen TSA-Dienste in v1)
- **Hosting**: Unraid-Server (Docker Container), extern via Cloudflare Tunnel erreichbar
- **Verfügbarkeit**: Abhängig von freetsa.org / DFN — kein SLA, Fallback auf lokales Hashing falls TSA nicht erreichbar
- **Rechtlich**: RFC 3161 / eIDAS-konform — für deutsche Gerichte akzeptierte Methode
- **Sicherheit**: Dateien enthalten potenziell sensitive Beweismittel — Zugriff muss auth-geschützt sein

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| RFC 3161 statt blockchain | EU-Standard, rechtlich anerkannt, kostenlos verfügbar | ✓ Good (v1.0 — DFN+FreeTSA+DigiCert produzieren rechtskonforme TSRs) |
| DFN-TSA primär, FreeTSA + DigiCert als Fallback | DFN ist auf deutscher Trust-List → stärkere Beweiskraft; FreeTSA/DigiCert sichern Verfügbarkeit | ✓ Good (v1.0 — Fallback-Kette mit `metadata.tsa_provider` + `tsa_fallback_chain` audit-trail) |
| Dateisystem (ULID-Verzeichnisse) + SQLite-Manifest | Einfachheit + direkte Verifikation; SQLite nur als Index, Quelle der Wahrheit bleibt Disk | ✓ Good (v1.0 — Drizzle-ORM ohne async overhead, `metadata.json` ist die contract source-of-truth) |
| Docker auf Unraid (node:22-bookworm-slim, NICHT Alpine) | Konsistent mit Stack; Alpine fehlt musl/native-module support | ✓ Good (v1.0 — read-only rootfs + dropped caps + uid 10001, live verifiziert) |
| OpenSSL CLI via execFile statt PKI.js für RFC 3161 verify | PKI.js historisch CVE-belastet; OpenSSL ist Referenz-Implementierung | ✓ Good (v1.0 — pre-finalization `openssl ts -verify` blockt fehlerhafte TSRs vor Bundle-write) |
| Hono statt Express | TypeScript-first, built-in multipart, kleiner | ✓ Good (v1.0 — komplette Route-Suite + busboy streaming + D-23 error envelope) |
| Vendored Alpine.js statt React/Vue/Build-Step | 7 kB, kein Build, ausreichend für Archive-UI | ✓ Good (v1.0 — list + detail + verify components; iter-3 script-order bug 87beef0 als reminder dokumentiert) |
| Page-vs-API auth split (303 redirect für Pages, JSON envelope für `/api/*`) | UX: Pages-Browser kennt nur Cookies; API-Clients erwarten JSON | ✓ Good (v1.0 — `requireSessionPage` vs `requireSessionApi`, `authOrApiKey` für Downloads) |

---
## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-18 after v1.0 milestone*
