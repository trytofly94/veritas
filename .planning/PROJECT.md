# auto-archive

## What This Is

Ein selbst gehostetes System zur automatisierten, gerichtssicheren Archivierung von Dateien aller Art — mit RFC 3161 Zeitstempeln und SHA-256 Integritätsprüfung. Dateien können per iOS Shortcut, n8n-Webhook oder Web-Upload eingereicht werden und landen manipulationssicher auf dem eigenen Unraid-Server. Für Lennart und Familie/kleines Team.

## Core Value

Jede archivierte Datei muss kryptografisch beweisbar zum Zeitpunkt der Einreichung existiert haben und unverändert geblieben sein — ohne Abhängigkeit von kostenpflichtigen Drittanbieter-Diensten.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Datei-Upload per HTTP-Endpunkt (für iOS Shortcut, n8n, curl)
- [ ] Web-Upload-Frontend (erreichbar von überall via Cloudflare Tunnel)
- [ ] SHA-256 Hash wird bei Eingang automatisch berechnet
- [ ] RFC 3161 Zeitstempel von FreeTSA und/oder DFN-TSA angefordert und gespeichert
- [ ] Strukturiertes Archiv pro Datei: original + .sha256 + .tsq + .tsr + metadata.json
- [ ] Privates Archiv-Browser-Frontend (alle archivierten Einträge anzeigen, suchen, filtern)
- [ ] Verifikationsfunktion: Integrität einer Datei nachträglich prüfbar
- [ ] Metadaten pro Einreichung: Absender, Zeitpunkt, IP, Beschreibung/Notiz
- [ ] Einfache Authentifizierung (API-Key für Uploads, Passwort-Schutz für Browser-Frontend)
- [ ] Download-Bundle: ZIP mit original + Hash + TSR Token + verify-Script
- [ ] Unterstützung aller Dateitypen (ZIP, PNG, PDF, JPEG, etc.)
- [ ] Docker Container auf Unraid (saubere Isolation, einfaches Update)
- [ ] n8n-Integration: n8n kann Dateien per Webhook einreichen

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
| RFC 3161 statt blockchain | EU-Standard, rechtlich anerkannt, kostenlos verfügbar | — Pending |
| FreeTSA als primäre TSA | Kostenlos, RFC 3161-konform, seit Jahren etabliert | — Pending |
| Dateisystem statt Datenbank für Storage | Einfachheit, direkte Verifikation, kein DB-overhead | — Pending |
| Docker auf Unraid | Konsistent mit bestehendem Stack, einfaches Deployment | — Pending |

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
*Last updated: 2026-05-16 after initialization*
