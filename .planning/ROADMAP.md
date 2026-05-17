# Roadmap: auto-archive

## Overview

Three phases deliver a tamper-proof file archiving system. Phase 1 builds the cryptographic core and Docker foundation — nothing else is built until timestamping works end-to-end on real Unraid hardware. Phase 2 exposes the engine as a secured HTTP API with a web upload form and download bundle, enabling iOS Shortcut and n8n submissions. Phase 3 adds the archive browser UI so the owner can inspect, search, and confirm the integrity of every archived file.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Core Archive Engine** - SHA-256 + RFC 3161 timestamping pipeline running inside Docker on Unraid
- [ ] **Phase 2: HTTP API + Web Upload** - Secured upload endpoint, web form, and download bundle accessible via Cloudflare Tunnel
- [ ] **Phase 3: Archive Browser** - Password-protected browser UI showing all archived entries with detail view

## Phase Details

### Phase 1: Core Archive Engine
**Goal**: A running Docker container on Unraid can accept a file, hash it, obtain an RFC 3161 timestamp, and write a complete tamper-proof archive bundle to a bind-mounted volume
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, SEC-03, META-01, META-02, META-03
**Success Criteria** (what must be TRUE):
  1. A file submitted via curl produces a directory on the Unraid volume containing original, .sha256, .tsq, .tsr, metadata.json, and verify.sh
  2. The TSR is immediately verified by OpenSSL after receipt; metadata.json records tsa_provider, tsa_status, and attested timestamp
  3. When DFN-TSA is unreachable, the system automatically retries with FreeTSA and records the fallback provider in metadata.json
  4. Running verify.sh from the bundle directory exits 0 and prints a verification-success message
  5. The container starts from docker-compose up on Unraid with all data written to bind-mounted volumes — nothing stored inside the container
**Plans**: 3 plans
  - [x] 01-01-PLAN.md — Walking Skeleton: scaffold + DFN happy-path upload (hash + TSA + bundle write)
  - [x] 01-02-PLAN.md — TSA fallback chain (DFN→FreeTSA→DigiCert) + pre-finalization verify + verify.sh in every bundle
  - [ ] 01-03-PLAN.md — Dockerize for Unraid (multi-stage build, bind-mounted volume, container smoke test, human-verified Unraid deploy)

### Phase 2: HTTP API + Web Upload
**Goal**: Users can submit files from iOS Shortcuts, n8n, curl, or a browser and download a verifiable ZIP bundle — all behind API-key and session authentication
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: UPLOAD-01, UPLOAD-02, UPLOAD-03, SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. curl POST to /api/upload with a valid X-API-Key header returns 200 with an archive entry ID; an invalid or missing key returns 401
  2. A file uploaded via the browser web form is archived and the confirmation page shows the archive ID and TSA status
  3. Requesting the download bundle for an archived entry returns a ZIP containing original, .sha256, .tsq, .tsr, metadata.json, tsa-cacert.pem, and VERIFY.md with correct § 286 ZPO legal framing
  4. Uploading a file larger than 100 MB returns a readable JSON error before Cloudflare terminates the connection
  5. The archive browser login page rejects wrong passwords and grants access with the correct password
**Plans**: TBD
**UI hint**: yes

### Phase 3: Archive Browser
**Goal**: The archive owner can open a browser, log in, and inspect every archived entry — seeing its metadata, TSA status, and being able to confirm its integrity — without using the command line
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: BROWSE-01, BROWSE-02
**Success Criteria** (what must be TRUE):
  1. The browser UI shows a chronological list of all archived entries with filename, submission date, file type, and TSA status visible at a glance
  2. Clicking an entry opens a detail view showing all metadata.json fields including submitter label, source IP, server timestamp, TSA-attested time, and tsa_provider
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Archive Engine | 0/3 | Not started | - |
| 2. HTTP API + Web Upload | 0/? | Not started | - |
| 3. Archive Browser | 0/? | Not started | - |
