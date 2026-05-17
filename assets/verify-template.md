# Archiv-Bundle — Verifikationsanleitung

**Archiv-ID:** {{id}}
**Originaldatei:** {{original_filename}}
**SHA-256:** {{sha256}}
**TSA-Anbieter:** {{tsa_provider}}
**TSA-Zeitstempel:** {{tsa_attested_at}}

---

Diese Datei beweist, dass die Originaldatei zum angegebenen Zeitpunkt unverändert existiert hat — sie beweist nicht die Urheberschaft.

---

## Was ist das?

Dieses Bundle enthält die Originaldatei sowie kryptografische Nachweise, die belegen, dass
die Datei zum angegebenen Zeitpunkt exakt in dieser Form existiert hat.

**Enthaltene Dateien:**

- `original.*` — Die archivierte Originaldatei (unveränderter Inhalt)
- `original.sha256` — SHA-256-Prüfsumme der Originaldatei (im `sha256sum -c`-Format)
- `original.tsq` — RFC-3161-Zeitstempel-Anfrage (TimeStampRequest)
- `original.tsr` — RFC-3161-Zeitstempel-Antwort (TimeStampResponse) der Zeitstempelstelle
- `tsa-cacert.pem` — CA-Zertifikatskette der Zeitstempelstelle (für Offline-Verifikation)
- `metadata.json` — Metadaten der Archivierung (Dateiname, Größe, MIME-Typ, IP, Zeitpunkt)
- `verify.sh` — Shell-Skript zur automatischen Verifikation (benötigt `openssl` und `sha256sum`)
- `VERIFY.md` — Diese Anleitung

**Was diese Datei beweist:** Die Kombination aus SHA-256-Hash und RFC-3161-Zeitstempel belegt,
dass die Originaldatei zum Zeitpunkt `{{tsa_attested_at}}` exakt diesen Inhalt hatte
(Integritäts- und Zeitexistenznachweis). Kein Urheberschaftsnachweis.

---

## Wie prüfen

### Weg (a): Automatisch per Skript

```bash
bash verify.sh
```

Das Skript prüft automatisch:
1. SHA-256-Hash der Originaldatei gegen `original.sha256`
2. RFC-3161-Zeitstempel in `original.tsr` gegen die Originaldatei

Voraussetzung: `openssl` (Version ≥ 1.1) und `sha256sum` müssen installiert sein.

### Weg (b): Manuell Schritt für Schritt

**Schritt 1 — SHA-256-Prüfsumme verifizieren:**

```bash
sha256sum -c original.sha256
```

Erwartete Ausgabe: `original.<ext>: OK`

**Schritt 2 — RFC-3161-Zeitstempel verifizieren:**

```bash
openssl ts -verify \
  -in original.tsr \
  -data original.<ext> \
  -CAfile tsa-cacert.pem
```

Ersetze `<ext>` durch die tatsächliche Dateiendung (z. B. `.pdf`, `.jpg`, `.zip`).
Erwartete Ausgabe: `Verification: OK`

**Was eine erfolgreiche Verifikation bedeutet:**
- Der SHA-256-Hash stimmt überein → die Datei ist unverändert.
- Die Zeitstempelstelle (`{{tsa_provider}}`) hat zum Zeitpunkt `{{tsa_attested_at}}`
  einen kryptografisch signierten Nachweis ausgestellt, dass dieser Hash zu diesem
  Zeitpunkt vorlag.

---

## Rechtlicher Rahmen

Dieses Archiv-Bundle ist auf die gerichtliche Verwendbarkeit im deutschen Rechtsraum
ausgelegt, insbesondere bei zivilrechtlichen Auseinandersetzungen.

**§ 286 ZPO (Freie Beweiswürdigung):**
Deutsche Gerichte beurteilen Beweise nach freier Überzeugung. Ein RFC-3161-Zeitstempel
belegt kryptografisch nachvollziehbar, dass eine Datei zu einem bestimmten Zeitpunkt
in exakt diesem Zustand vorlag. Er ist kein Beweis für den Autor oder die Herkunft der Datei,
aber ein belastbarer Integritäts- und Zeitexistenznachweis.

**RFC 3161 (Internet X.509 PKI Time-Stamp Protocol):**
Der Standard beschreibt, wie eine Zeitstempelstelle (TSA) einen kryptografisch signierten
Nachweis über den Hash eines Dokuments zu einem bestimmten Zeitpunkt ausstellt.
Die TSA signiert den TimeStampToken mit ihrem privaten Schlüssel; die Signatur kann
gegen das in `tsa-cacert.pem` enthaltene CA-Zertifikat verifiziert werden.

**eIDAS-Einordnung:**
Im Sinne der eIDAS-Verordnung (Art. 41–42) handelt es sich um einen elektronischen
Zeitstempel. Ob dieser als „qualifizierter elektronischer Zeitstempel" (QeZS) gilt,
hängt vom TSA-Anbieter ab: DFN-PKI ist auf der deutschen Vertrauensliste gelistet
und erfüllt die Anforderungen; FreeTSA ist nicht akkreditiert, liefert aber einen
technisch gleichwertigen RFC-3161-konformen Nachweis.

**Wichtiger Hinweis:** Dieser Nachweis belegt **Integrität und Zeitexistenz**,
nicht die Urheberschaft der Datei. Wer die Datei erstellt oder an das Archivierungssystem
übermittelt hat, ist aus diesem Bundle allein nicht ableitbar.

---

## TSA-Vertrauensquelle

**Verwendeter TSA-Anbieter für dieses Bundle:** `{{tsa_provider}}`

Das Archivierungssystem verwendet eine Fallback-Kette aus drei Zeitstempelstellen:

1. **DFN (zeitstempel.dfn.de)** — Deutsches Forschungsnetz, auf der deutschen
   Vertrauensliste gelistet (DFN-PKI). Primäre Wahl wegen institutioneller Absicherung
   und starker Glaubwürdigkeit vor deutschen Gerichten.

2. **FreeTSA (freetsa.org)** — Kostenloser RFC-3161-konformer Dienst, seit Jahren
   in Betrieb. Nicht akkreditiert, aber technisch vollwertig. Wird als Fallback
   eingesetzt, wenn DFN nicht erreichbar ist.

3. **DigiCert (timestamp.digicert.com)** — Kommerzieller Anbieter als letzte
   Fallback-Stufe. Hohe Verfügbarkeit; anerkannte CA.

Die für dieses Bundle verwendete Kette ist in `metadata.json` unter
`tsa_fallback_chain` protokolliert. Der in `original.tsr` enthaltene Zeitstempel
stammt vom Anbieter `{{tsa_provider}}`.

Das CA-Zertifikat für die Verifikation befindet sich in `tsa-cacert.pem` (bereits
dem TSA-Anbieter entsprechend vorausgewählt).
