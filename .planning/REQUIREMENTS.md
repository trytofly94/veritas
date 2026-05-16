# Requirements: auto-archive

**Defined:** 2026-05-16
**Core Value:** Jede archivierte Datei muss kryptografisch beweisbar zum Zeitpunkt der Einreichung existiert haben und unverändert geblieben sein — ohne Abhängigkeit von kostenpflichtigen Drittanbieter-Diensten.

## v1 Requirements

### Core Archive Engine

- [ ] **CORE-01**: System berechnet SHA-256 Hash automatisch bei Eingang jeder Datei
- [ ] **CORE-02**: System fordert RFC 3161 Zeitstempel von DFN-TSA an (FreeTSA als Fallback bei Fehler)
- [ ] **CORE-03**: System speichert pro Einreichung ein strukturiertes Bundle: `original.<ext>`, `original.sha256`, `original.tsq`, `original.tsr`, `metadata.json`, `verify.sh`
- [ ] **CORE-04**: System ermöglicht nachträgliche Verifikation der Dateiintegrität per OpenSSL (via `verify.sh` im Bundle)

### Upload

- [ ] **UPLOAD-01**: Nutzer kann Datei per HTTP POST an `/api/upload` mit `X-API-Key` Header einreichen (für iOS Shortcut, n8n, curl)
- [ ] **UPLOAD-02**: Nutzer kann Datei über ein Web-Formular im Browser hochladen (extern erreichbar via Cloudflare Tunnel)
- [ ] **UPLOAD-03**: Nutzer kann ein Download-Bundle (ZIP) mit original + SHA-256 + TSR + CA-Zertifikat + VERIFY.md herunterladen

### Archiv-Browser

- [ ] **BROWSE-01**: Nutzer sieht Liste aller archivierten Einträge chronologisch (Dateiname, Datum, Typ, TSA-Status)
- [ ] **BROWSE-02**: Nutzer kann Detail-Ansicht eines Eintrags öffnen mit allen Metadaten und Verifikations-Status

### Sicherheit

- [ ] **SEC-01**: Upload-Endpunkt ist per API-Key abgesichert (Header `X-API-Key`), ungültige Keys erhalten 401
- [ ] **SEC-02**: Archiv-Browser ist per Passwort-Login abgesichert (einfache Session-Auth)
- [ ] **SEC-03**: DFN-TSA wird primär verwendet; bei Fehler automatischer Fallback auf FreeTSA; TSA-Quelle wird im `metadata.json` gespeichert

### Metadaten

- [ ] **META-01**: System erfasst Server-UTC-Zeitstempel der Einreichung in `metadata.json`
- [ ] **META-02**: Einreicher kann beim Upload ein Label / Namen angeben (wird in `metadata.json` gespeichert)
- [ ] **META-03**: System erfasst Quell-IP-Adresse der Einreichung in `metadata.json`

## v2 Requirements

### Archiv-Browser

- **BROWSE-03**: Nutzer kann Einträge nach Datum, Typ oder Label filtern und in Beschreibungen suchen (SQLite FTS5)
- **BROWSE-04**: Nutzer kann Datei-Integrität direkt im Browser verifizieren ohne Kommandozeile

### Metadaten

- **META-04**: Nutzer kann beim Upload eine Freitext-Beschreibung / Notiz eingeben

### Rechtliches

- **LEGAL-01**: System zeigt beim Upload und im Bundle einen rechtlichen Hinweis: RFC 3161 ist unterstützendes Beweismittel (§ 286 ZPO), keine gesetzliche Vermutung (§ 371a ZPO)

### Erweitert

- **EXT-01**: OpenTimestamps (Bitcoin Blockchain) als zusätzlicher Zeitstempel-Anker
- **EXT-02**: Automatisches Backup des Archivs (rclone zu Backblaze B2 o.ä.)
- **EXT-03**: TSA-Retry-Queue: asynchrone Verarbeitung wenn TSA beim Upload nicht erreichbar

## Out of Scope

| Feature | Reason |
|---------|--------|
| Akkreditierte/kostenpflichtige TSA (D-Trust, Bundesdruckerei) | Kostenlos-first; kann manuell ergänzt werden wenn nötig |
| MinIO / S3 Object Lock | Dateisystem auf Unraid reicht für v1 |
| Blockchain-Timestamping (OpenTimestamps) | v2 |
| WhatsApp-API-Direktintegration | User exportiert manuell und reicht ZIP ein |
| OCR / Inhaltsindexierung | Out of scope v1 |
| Notarielle Beglaubigung / QES | Außerhalb des technischen Systems |
| Öffentliche Multi-Tenant-Nutzung | Nur Lennart + Familie mit API-Key |
| Mobile App | iOS Shortcut reicht für mobile Einreichung |

## Traceability

| Phase | Requirements |
|-------|-------------|
| Phase 1 | CORE-01, CORE-02, CORE-03, CORE-04, SEC-03, META-01, META-02, META-03 |
| Phase 2 | UPLOAD-01, UPLOAD-02, UPLOAD-03, SEC-01, SEC-02 |
| Phase 3 | BROWSE-01, BROWSE-02 |
