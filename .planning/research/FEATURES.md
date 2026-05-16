# Feature Landscape: Tamper-Proof File Archiving System

**Domain:** Self-hosted tamper-proof evidence archiving (civil/labor law use case, Germany/EU)
**Researched:** 2026-05-16
**Confidence:** HIGH for core features, MEDIUM for legal nuance, HIGH for iOS/n8n patterns

---

## Table Stakes

Features users and lawyers expect. Missing = product feels incomplete or legally weak.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| SHA-256 hash on ingest | Proves file unchanged since archival — foundation of all tamper-evidence claims | Low | Computed server-side immediately on receipt, stored in `.sha256` sidecar |
| RFC 3161 timestamp from accredited TSA | Under eIDAS Art. 41 & § 371a ZPO, the only mechanism that creates legal presumption of time. Courts expect this. | Medium | FreeTSA or DFN-TSA; store `.tsq` + `.tsr` files alongside original |
| Immutable storage after ingest | The archive cannot modify files post-submission (no overwrites, no deletes) | Medium | `chattr +i` on Linux filesystem, or append-only directory structure |
| Per-file metadata capture | Date/time, submitter identity, source IP, user-provided description, MIME type, file size | Low | `metadata.json` sidecar per archive entry |
| Tamper-detection on verification | Re-hash file and compare to stored hash; verify TSR signature against TSA cert chain | Medium | OpenSSL `ts -verify` is the reference workflow |
| Download bundle / evidence package | ZIP with: original file + hash + TSR token + CA certificate + human-readable verification instructions | Medium | Courts and lawyers need a self-contained package they can hand to experts |
| Authenticated access | API key for upload endpoints; password/token for browser UI | Low | Without this, evidence provenance is weakened ("who submitted this?") |
| Audit log of access | Every download, view, and verification attempt is logged with timestamp + actor | Low | Required for chain-of-custody integrity |
| Support for arbitrary file types | WhatsApp exports, screenshots, PDFs, ZIPs, audio, video | Low | No format filtering — MIME type is captured but not enforced |
| Human-readable verification report | A plain-language explanation of what the hash and TSR prove, suitable for attaching to a legal brief | Medium | Non-technical courts need "what does this cryptographic proof mean?" explained |

---

## Differentiators

Features that set this system apart. Not universally expected, but provide meaningful value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Verification HTML/PDF export | Self-contained report: hash value + TSR decoded data + verification commands printed out, ready to attach to a Schriftsatz | Medium | Combine archive metadata + TSR details into a printable page |
| Fallback archival when TSA unreachable | Record "TSA unavailable at ingest" + local hash + retry queue; partial evidence is better than nothing | Medium | FreeTSA has no SLA; graceful degradation matters for reliability |
| n8n webhook ingest endpoint | Direct machine-to-machine submission from existing n8n automations (Telegram forwards, scheduled screenshots, etc.) | Low | POST multipart/form-data to `/ingest` with `X-API-Key` header |
| iOS Shortcut deep integration | Share-sheet shortcut that captures the file, prompts for a description, and posts to the archive in one tap | Low | "Get Contents of URL" with Form body type; API key in Authorization header |
| Structured search + filter in browser UI | Search by submitter, date range, description keyword, MIME type, file name | Medium | Critical for finding evidence when preparing for legal action months later |
| Tag/label system | User-assigned tags per submission (e.g. "WhatsApp Nachricht", "Arbeitszeugnis", "Kündigung") | Low | Freeform text tags stored in metadata.json |
| TSR retry on failed timestamp | Background job re-attempts TSA request if ingest-time request failed; stores final TSR when successful | Medium | Improves completeness without complicating the hot path |
| Duplicate detection | SHA-256 match on ingest warns if identical file was already archived (dedup by hash) | Low | Prevents accidental duplicate entries; does not block submission |

---

## Anti-Features (Do Not Build in v1)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| OCR / full-text indexing | High complexity, large deps (Tesseract), not needed for evidence retrieval by metadata | Tag submissions at ingest; search by metadata fields |
| Blockchain timestamping (OpenTimestamps) | Bitcoin anchor adds latency, requires external dependency, no legal advantage over RFC 3161 in EU/Germany | RFC 3161 is sufficient and legally preferred under eIDAS |
| Qualified electronic signature (QES) / D-Trust / Bundesdruckerei | Paid service, complex onboarding, out of scope per PROJECT.md | FreeTSA + DFN-TSA cover the non-qualified tier; upgrade path documented |
| WORM via MinIO Object Lock | Adds MinIO dependency; Unraid filesystem with `chattr +a` covers the same need | Filesystem-level append-only flag |
| Multi-tenant / external user accounts | Auth complexity, liability, out of scope per PROJECT.md | API key per known submitter (Lennart + family), managed in config |
| WhatsApp API direct ingest | API access requires Meta Business approval, complex and brittle | User exports chat manually and submits the ZIP |
| Automated legal brief generation | Requires legal knowledge, liability risk | Generate verification report only; legal framing is user's job |
| Evidence chain across multiple files / case management | Case grouping, linking related submissions — complex case management product territory | Tags achieve 80% of the value; full case management is a different product |
| Video transcription / speech-to-text | High compute, not evidence-relevant for v1 use case | Files are archived opaquely; content interpretation is out of scope |
| Mobile app | iOS Shortcut covers mobile submission; full native app is disproportionate effort | Shortcut + mobile-responsive web UI is sufficient |

---

## iOS Shortcut Patterns

### Recommended Shortcut Structure

The canonical pattern for a share-sheet-triggered file upload shortcut uses the "Get Contents of URL" action with `Form` body type (not `File` or `JSON`).

```
Shortcut trigger: Share Sheet (receives: Files, Images, PDFs, Media)
↓
Action: Ask for Input
  - Prompt: "Beschreibung / Notiz (optional)"
  - Input type: Text
  - Store result as: description
↓
Action: Get Contents of URL
  - URL: https://archive.example.com/ingest
  - Method: POST
  - Headers:
      X-API-Key: [stored in Shortcut variable or Keychain]
  - Request Body: Form
      file: [Shortcut Input] (the shared file)
      description: [description variable]
      submitter: "Lennart" (hardcoded or Ask for Input)
↓
Action: If (response status check)
  - Get Dictionary Value "id" from response
  - Show notification: "Archiviert: [id]"
  - Otherwise: Show alert "Fehler beim Archivieren"
```

**Key design decisions:**

- Use `Form` body type, not `File` — this sends `multipart/form-data` which is how most web servers expect file uploads. The `File` body type sends raw binary without field names.
- API key goes in a `Header` named `X-API-Key` (simpler than Base64-encoded Authorization for API key use case).
- The shortcut should be added to the share sheet so users can trigger it from Photos, Files, Mail, etc.
- The server-side MIME type is derived from the uploaded form part — no need to send it explicitly.
- iOS does not expose the originating app name to Shortcuts, so capture it via an optional "Ask for Input" prompt if provenance matters.

**Limitation to be aware of:** iOS Shortcuts cannot send truly arbitrary HTTP headers with dynamic values stored securely at rest — API keys are either hardcoded in the shortcut (visible to anyone who views it) or typed on each run. Mitigation: treat the API key as a long, random token (not a password) and accept this limitation for a trusted-family use case.

---

## n8n Webhook Patterns

### Recommended Ingest Flow from n8n

```
Trigger: n8n Webhook node
  - Method: POST
  - Binary data mode: enabled
  - N8N_DEFAULT_BINARY_DATA_MODE=filesystem (env var on self-hosted instance)
  - N8N_PAYLOAD_SIZE_MAX=100 (MB, adjust for large files)
↓
HTTP Request node
  - URL: https://archive.example.com/ingest
  - Method: POST
  - Body Content Type: Form Data (multipart)
  - Parameters:
      file: [binary item from webhook]
      description: [from webhook body field]
      submitter: "n8n-automation"
  - Headers:
      X-API-Key: [stored in n8n Credential]
```

**Important n8n-specific notes:**

- Use `multipart/form-data` (Form Data body type in HTTP Request node), not `application/octet-stream`. The webhook node accepts binary attachments when "Binary Data" is enabled.
- On self-hosted n8n, binary files are stored on the local filesystem between nodes. Default payload size is 16MB — increase via `N8N_PAYLOAD_SIZE_MAX` env var for large files (WhatsApp ZIP exports can exceed 100MB).
- Store the archive API key in an n8n Header Auth credential, not inline in the workflow, so it can be rotated without editing workflows.
- A known n8n issue (v1.89.2+): the `binary` property may be missing from webhook output for `multipart/form-data` uploads in some cloud versions. Self-hosted instances are not affected the same way.

---

## Metadata Standards

### Per-Entry Metadata (metadata.json)

These fields should be captured and stored per archive submission to satisfy German civil procedure requirements (§ 371a ZPO, GoBD Unveränderbarkeit principle, ISO/IEC 27037):

| Field | Source | Purpose |
|-------|--------|---------|
| `id` | Server-generated UUID | Unique archive entry identifier |
| `submitted_at` | Server clock (UTC ISO 8601) | Canonical submission timestamp |
| `submitter` | API key mapping or form field | Identity of submitter for chain-of-custody |
| `source_ip` | HTTP request | Network provenance; supports or undermines origin claims |
| `filename_original` | Upload form field | Original filename as submitted |
| `mime_type` | Server-detected (libmagic or equivalent) | File type for context |
| `file_size_bytes` | Measured at ingest | Reference size for integrity |
| `sha256` | Computed server-side on raw file bytes | Core tamper-evidence hash |
| `tsa_url` | Which TSA was used | FreeTSA vs DFN-TSA for verification chain |
| `tsr_received_at` | When TSR was obtained | Separate from submission time if TSA was slow or retried |
| `tsr_status` | `ok` / `pending` / `failed` | Whether timestamp was successfully obtained |
| `description` | User-provided free text | Context: "WhatsApp Export Kündigung vom 2025-03-01" |
| `tags` | User-provided array | Classification labels |
| `archive_version` | Application version | For future format migration |

**Fields NOT to capture (privacy + minimization):**
- Device model or iOS version from Shortcuts (not reliably available, not required)
- Full HTTP request headers (excessive; IP is sufficient)
- User agent string (low evidentiary value, high noise)

### What Makes a Submission Court-Credible in Germany

Under § 371a ZPO, a private electronic document without a qualified electronic signature (QES) is subject to freie richterliche Beweiswürdigung (discretionary judicial assessment, § 286 ZPO). This means it can still be admitted and persuasive — the RFC 3161 timestamp and SHA-256 hash together provide:

1. **Temporal proof**: The file existed at the timestamp moment (TSR proves this against the TSA's clock).
2. **Integrity proof**: The file has not changed since the hash was computed (hash comparison proves this).
3. **Chain of custody narrative**: metadata.json + audit log establish who submitted it, from where, when.

The combination is not equivalent to a QES (which would carry a legal presumption under § 371a ZPO), but it is strong supporting evidence. In practice, German civil courts regularly admit RFC 3161-timestamped documents as evidence when the opposing party cannot demonstrate manipulation.

**For full § 371a ZPO presumption** (which shifts burden of proof to the opposing party), the document would need a QES from a QTSP listed on the BNetzA Trusted List. This is a post-v1 upgrade path, not a v1 requirement.

---

## Download / Export Formats

### Evidence Bundle (ZIP)

The primary export is a self-contained ZIP structured as:

```
archive-[id].zip
├── original.[ext]          # The file exactly as archived
├── original.sha256         # SHA-256 hash (hex string + filename, sha256sum format)
├── original.tsq            # RFC 3161 timestamp query (what was sent to TSA)
├── original.tsr            # RFC 3161 timestamp response (what TSA returned)
├── metadata.json           # Full entry metadata (see above)
├── tsa-cacert.pem          # TSA CA certificate chain for offline verification
└── VERIFY.md               # Human-readable step-by-step verification instructions
```

**VERIFY.md content pattern** (critical for court use — experts need to know how to verify):

```markdown
# Verification Instructions for Archive Entry [id]

This bundle proves that the file `original.[ext]` existed on [date]
and has not been modified since.

## Step 1: Verify file integrity
sha256sum -c original.sha256

## Step 2: Verify RFC 3161 timestamp
openssl ts -verify -data original.[ext] -in original.tsr -CAfile tsa-cacert.pem

## Step 3: Read timestamp details
openssl ts -reply -in original.tsr -text

## What this proves
The timestamp response (original.tsr) was signed by [TSA name] and certifies
that the SHA-256 hash [hash] was submitted to the TSA at [timestamp].
This means the file existed at that moment and has not changed since.
```

**Why this format:**
- OpenSSL commands are reproducible, auditable, and tool-independent
- Including `tsa-cacert.pem` makes the bundle self-contained — verification works offline even if FreeTSA changes its certificate
- `sha256sum -c` format is POSIX-standard, works on Linux/macOS without additional software
- A German IT-Sachverständiger (technical expert witness) can run these commands and confirm the result in court

---

## Verification Workflow

### "Prove this file is authentic" — The Practical Flow

```
1. User receives: archive-[id].zip (from Download Bundle feature)
2. User gives ZIP to lawyer or IT expert
3. Expert extracts ZIP, runs:
   a. sha256sum -c original.sha256           → "OK" confirms file not modified
   b. openssl ts -verify -data original.[ext] -in original.tsr -CAfile tsa-cacert.pem
                                              → "Verification: OK" confirms timestamp valid
   c. openssl ts -reply -in original.tsr -text → Shows human-readable timestamp details
4. Expert writes declaration: "I verified the file on [date], SHA-256 matches, TSR issued
   by [TSA] at [time], signature chain valid."
5. Declaration + ZIP submitted to court as Anlage to Schriftsatz
```

### In-App Verification (for the archive owner)

The browser UI should offer a "Verify" button per entry that:
1. Re-hashes the stored file and compares to recorded SHA-256
2. Re-runs OpenSSL timestamp verification server-side
3. Shows green/red status with explanation
4. Logs the verification attempt in the audit trail

This is useful for periodic integrity checks and for confirming the archive is still intact before legal proceedings.

---

## Sources

- [RFC 3161 Timestamps and Court Admissibility](https://snapoena.com/blog/rfc-3161-timestamps-what-courts-accept)
- [Digital Evidence under § 371a ZPO and eIDAS](https://truescreen.io/articles/digital-evidence-german-civil-procedure-zpo-371a-eidas/)
- [RFC 3161 Timestamp Verification with OpenSSL](https://weisser-zwerg.dev/posts/trusted_timestamping/)
- [Metaspike: Trusted Timestamping in Digital Forensics](https://www.metaspike.com/trusted-timestamping-rfc-3161-digital-forensics/)
- [n8n Webhook Binary Data Handling](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [Self-hosted n8n binary data gotcha](https://khmuhtadin.com/blog/self-hosted-vs-cloud-n8n-binary-data-gotcha/)
- [iOS Shortcuts file upload via Get Contents of URL](https://heydingus.net/blog/2021/6/shortcuts-tips-uploading-images-to-imagekit-for-blogging)
- [eIDAS Qualified Timestamp Legal Value](https://truescreen.io/articles/qualified-electronic-timestamps-legal-value/)
- [Digital Evidence Preservation](https://digitalevidence.ai/blog/how-to-ensure-digital-evidence-preservation)
- [Chain of Custody Court Requirements](https://truescreen.io/articles/digital-evidence-court-chain-custody-certification/)
