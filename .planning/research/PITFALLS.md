# Domain Pitfalls: Tamper-Proof File Archiving

**Domain:** Self-hosted RFC 3161 evidence archiving
**Researched:** 2026-05-16
**Primary use case:** Civil/labor law evidence preservation for German courts

---

## Legal Pitfalls

### L1: FreeTSA is NOT a Qualified Trust Service Provider (QTSP)

**What goes wrong:** You build the entire system around FreeTSA and then discover in a legal dispute that the opposing party (or judge) challenges the timestamp's probative value because FreeTSA is not on any EU Trusted List.

**Why it happens:** FreeTSA is functional and RFC 3161-compliant but explicitly listed as "Untrusted/Unvalidated" in community gists of TSA servers. It does not appear on the EU QTSP Trusted List. Under eIDAS Article 42, only qualified timestamps from accredited QTSPs carry a legal presumption of accuracy — meaning in a dispute, the *opposing party* must prove the date is wrong. With a non-qualified TSA, the burden is reversed: *you* must prove it.

**Consequences:** In German civil/labor court proceedings, a FreeTSA timestamp is admissible as evidence (§§ 286, 371 ZPO — free evidentiary evaluation) but carries low inherent weight. Opposing counsel can challenge it by pointing to the lack of accreditation. The judge exercises discretion. This does not mean useless — cryptographic proof of file integrity is still valuable — but the legal presumption of correctness is absent.

**Prevention:**
- Be explicit in documentation that this system provides "advanced" not "qualified" timestamps
- For highest-stakes evidence, manually also submit the file to a QTSP (DFN-TSA for non-commercial/academic, or a paid service like D-Trust)
- Store DFN-TSA as a secondary TSA from day one — it is free for German non-commercial use and has a university/research accreditation, which courts trust more
- Document that FreeTSA + DFN-TSA dual timestamping is used, not just FreeTSA alone

**Detection:** Legal challenge in discovery/disclosure phase; opposing party questions TSA credibility.

---

### L2: DFN-TSA Terms of Use: Strictly Non-Commercial

**What goes wrong:** You use DFN-TSA (zeitstempel.dfn.de) as a "trusted" fallback and later discover the Nutzungsbedingungen explicitly forbid commercial use. If this archive is used in a business context (e.g., employer-employee dispute), the TSA was used outside its terms.

**Why it happens:** DFN-PKI is operated for German research/education networks (Deutsches Forschungsnetz). Commercial use is explicitly excluded per DFN statutes.

**Consequences:** The timestamp itself remains cryptographically valid. But in a dispute involving commercial activity, using it could be pointed to as a terms-of-service violation. More practically: DFN could terminate access at any time without notice for non-compliant users.

**Prevention:** Use DFN-TSA only for personal, family, non-commercial archiving. Document in the system's README that this constraint exists. If the use case ever becomes commercial, replace DFN-TSA with a commercial TSA.

---

### L3: Missing Chain of Custody Documentation

**What goes wrong:** The file is timestamped perfectly but there is no record of *how* the file arrived — who submitted it, from what device, at what IP, what was said about it at submission time. A German court evaluating authenticity will ask: "How do we know this WhatsApp export was not edited before upload?"

**Why it happens:** Developers focus on the cryptographic layer and neglect the procedural metadata layer. The TSR proves the file existed at time T. It does not prove the file is what you claim it is.

**Consequences:** Even a perfect TSR is challengeable: "Yes, the file was timestamped, but that proves nothing about whether it was already altered before archiving." Courts require a coherent narrative connecting the original source to the archived copy.

**Prevention:**
- Record at ingestion: submitter identity, submission timestamp (server-side), source description, IP address, device type (user-agent)
- Store a `metadata.json` per archived file with all provenance fields
- If archiving a WhatsApp export: record "exported from device X by user Y on date Z" as a free-text note at submission time
- For highest-stakes files: submit within minutes of creation/export, not days later (time gap weakens the narrative)

---

### L4: Confusing "Tamper-Proof Since Archiving" with "Authentic at Archiving Time"

**What goes wrong:** The system correctly prevents tampering after archiving. But if someone submits an already-edited screenshot, the TSR proves the edited version existed at time T — not the original.

**Why it happens:** RFC 3161 timestamps prove *existence and integrity from a point in time*, not *authenticity of origin*. The distinction matters legally.

**Consequences:** Misrepresenting the system's capabilities in court ("this is tamper-proof evidence") invites credibility damage when the limitation is exposed.

**Prevention:** Document clearly in the system UI and verification output: "This archive proves the file has not changed since [timestamp]. It does not independently verify what the file originally was." The chain-of-custody metadata (L3) is the complementary layer that helps establish origin.

---

## Technical Pitfalls

### T1: Not Including the TSA Certificate in the TSR Request (`-cert` flag)

**What goes wrong:** You generate a TSQ without requesting certificate inclusion. The TSR is stored. Years later, during verification, you cannot reconstruct the certificate chain because the TSA's certificate has rotated or the TSA no longer operates.

**Why it happens:** The `-cert` flag in OpenSSL's `ts` command is easy to overlook. Without it, the TSR does not embed the TSA's signing certificate.

**Consequences:** Verification fails with "unable to get local issuer certificate" or equivalent. The timestamp token is cryptographically intact but practically unverifiable without external certificate retrieval. If FreeTSA ever shuts down, their certificate becomes unavailable.

**Prevention:**
- Always use `-cert` in the TSQ: `openssl ts -query -sha256 -cert -data <file> -out <file>.tsq`
- Store not just the `.tsr` but also download and save the TSA's CA certificate bundle at archiving time
- Create an annual "CA certificate refresh" task — store current FreeTSA root CA and intermediate CA in the archive

---

### T2: Hash Algorithm Mismatch Between TSQ and Stored Hash

**What goes wrong:** The application computes SHA-256 for the stored `.sha256` file but uses a different algorithm when building the TSQ (e.g., SHA-1 defaults in older OpenSSL versions, or SHA3-256 which RFC 3161 does not support).

**Why it happens:** RFC 3161 only recognizes specific hash algorithm OIDs. SHA3-256 is not in RFC 3161's OID registry. Some OpenSSL versions default to SHA-1. The TSQ gets accepted by the TSA but contains a different hash than what you stored.

**Consequences:** The `.sha256` file and the TSR prove different things. Verification tooling shows "hash mismatch." The archive's integrity proof is broken.

**Prevention:** Explicitly pass `-sha256` in all `openssl ts -query` calls. Never rely on defaults. Assert in code that the hash in the TSR response matches the locally computed SHA-256.

---

### T3: Not Verifying the TSR Response After Receipt

**What goes wrong:** The application sends the TSQ, receives a TSR, and stores it — without verifying that the TSR actually contains the correct hash and that the TSA signature is valid.

**Why it happens:** Developers treat the HTTP 200 response as success. The TSR could be malformed, contain the wrong imprint, or have a bad signature (network corruption, TSA bug).

**Consequences:** Stored TSRs are invalid. This is only discovered years later when attempting to use them as evidence.

**Prevention:**
- After receiving every TSR: run `openssl ts -verify -in <file>.tsr -queryfile <file>.tsq -CAfile <ca.pem>` as part of the archival pipeline
- If verification fails: log error, mark the archive entry as "TSR_INVALID", retry with fallback TSA
- Store the verification result in `metadata.json`

---

### T4: TSA Unavailability Without Fallback

**What goes wrong:** FreeTSA is down (no published SLA; community reports intermittent issues). The upload succeeds but the archiving pipeline halts or silently skips the timestamp step.

**Why it happens:** No fallback TSA configured. No queue/retry mechanism. The system either blocks uploads or archives without a TSR.

**Consequences:** Files are archived without cryptographic timestamp. This may not be noticed until evidence is needed.

**Prevention:**
- Configure both FreeTSA and DFN-TSA; try primary, fall back to secondary
- If both fail: store file with SHA-256 hash and mark status as `PENDING_TSR`; implement a background retry queue
- Never reject an upload because the TSA is unavailable — store first, timestamp asynchronously
- Log all TSA failures with timestamp for audit purposes

---

### T5: Storing TSR Without the Original `.tsq` File

**What goes wrong:** Only the `.tsr` (response) is saved, not the `.tsq` (query). Verification is harder without the original query, and some tooling requires it.

**Prevention:** Store both `.tsq` and `.tsr` in every archive entry. The storage overhead is negligible (< 1KB each).

---

### T6: Certificate Revocation Not Checked

**What goes wrong:** The TSA's signing certificate gets revoked (compromise, expiration, CA policy change). All TSRs signed with that certificate lose their trustworthiness. If you don't check CRL/OCSP at verification time, you won't know.

**Why it happens:** Revocation checking is a separate step from signature verification and is easy to omit.

**Prevention:**
- During verification, check CRL or OCSP for the TSA certificate used at signing time
- Store the CRL snapshot or OCSP response at time of archiving alongside the TSR (RFC 3161 `accuracy` and revocation info should be preserved)
- Alert if FreeTSA's certificate is approaching expiration

---

### T7: Cloudflare Tunnel 100 MB Upload Cap

**What goes wrong:** A WhatsApp ZIP export containing videos exceeds 100 MB. The upload via Cloudflare Tunnel fails with an opaque error (413 or timeout). The user does not understand why.

**Why it happens:** All Cloudflare plans (Free and Pro) cap proxied HTTP request bodies at 100 MB. Cloudflare Tunnel in proxied mode inherits this limit.

**Consequences:** Large evidence bundles (video exports, large backups) cannot be uploaded via the web frontend or iOS Shortcut.

**Prevention:**
- Cap upload UI at 100 MB with a clear user-facing error
- For large files: implement chunked upload or direct LAN upload path (bypass Cloudflare via local IP)
- Document the 100 MB ceiling in the system description
- Consider compressing/splitting large ZIPs before archiving

---

### T8: iOS Shortcut Base64 Header Truncation

**What goes wrong:** The iOS Shortcut uses a Bearer token or API key in an Authorization header. If the key is long, iOS Shortcuts' "Get Contents of URL" silently truncates headers encoded in Base64 at 76 characters (MIME line-wrapping behavior).

**Why it happens:** iOS Shortcuts applies RFC 2045 MIME Base64 line folding by default in some encoding operations. The Authorization header value gets line-wrapped, causing a malformed header that the server rejects as 401 Unauthorized.

**Consequences:** All uploads from iOS appear to fail authentication, but the server never receives a valid Authorization header. This is extremely hard to debug because the shortcut appears to be configured correctly.

**Prevention:**
- Keep API keys short (32 hex chars) — avoid long JWT-style tokens for this interface
- Test the Shortcut by logging the raw Authorization header your server receives
- Use simple `Bearer <key>` with a short key rather than a full JWT

---

### T9: iOS Shortcut Does Not Inspect HTTP Status Codes

**What goes wrong:** The "Get Contents of URL" action in iOS Shortcuts does not natively expose the HTTP response status code. A 500 error from the server looks identical to a 200 success if the response body is empty.

**Prevention:**
- Always return a JSON body with a `status` and `message` field from the API, even on error
- Structure the Shortcut to check the response body content (`"ok": true` / `"error": "..."`) rather than inferring success from absence of failure

---

## Operational Pitfalls

### O1: Archive Data Written Inside Docker Container (No Bind Mount)

**What goes wrong:** The Docker container stores archived files in `/app/archive/` inside the container's writable layer. When the container is removed (update, recreation), all archived evidence is permanently lost.

**Why it happens:** Forgetting to declare and mount a Docker volume for the archive directory. In Unraid, if the docker.img file is corrupted and needs recreation, all container-internal data is gone.

**Prevention:**
- Bind-mount the archive directory to an Unraid share: `-v /mnt/user/appdata/auto-archive/data:/app/data`
- Bind-mount the database (if using SQLite): `-v /mnt/user/appdata/auto-archive/db:/app/db`
- Never write persisted data inside the container; treat container as stateless
- On Unraid: store in the `appdata` share on the cache drive, but configure Mover to NOT move this share to the array (or use array share directly for legal data persistence)

---

### O2: Docker Image Corruption on Unraid (Cache Full)

**What goes wrong:** The Unraid cache drive fills up. Docker writes fail. The docker.img file is corrupted on an unclean shutdown. Container is recreated from scratch, and any data inside the container (not bind-mounted) is lost.

**Prevention:**
- All data outside docker.img via bind mounts (see O1)
- Monitor cache drive utilization; set alerts at 80% capacity
- Unraid's docker.img itself should be on a reliable drive; do not allow it to fill

---

### O3: Unraid File Permission Mismatches (Post-6.10)

**What goes wrong:** Since Unraid 6.10, new appdata directories are created with 755 permissions instead of 777. A Docker container running as a non-root user (e.g., UID 1000) cannot write to the bind-mounted directory.

**Why it happens:** The permission change in Unraid 6.10 is a security improvement but breaks containers that previously relied on 777 world-writable directories.

**Consequences:** Container starts successfully but all write operations fail silently or with "Permission denied" errors. Archive entries are not stored.

**Prevention:**
- Explicitly set the container's PUID/PGID environment variables to match the Unraid share owner (usually 99:100 for `nobody:users`)
- Or run a `chown -R 99:100 /mnt/user/appdata/auto-archive` during setup
- Document the required UID/GID in the deployment instructions
- Add a startup health check that verifies write access to the archive directory

---

### O4: No Backup Strategy for the Archive Itself

**What goes wrong:** The archive lives only on the Unraid server. A drive failure, ransomware attack, or accidental deletion destroys all archived evidence at the worst possible time — during active litigation.

**Prevention:**
- Treat the archive directory as critical data: back up to at least one off-server location
- Unraid's built-in backup to a secondary array drive or USB is insufficient alone
- Consider: rsync to a cloud bucket (encrypted), or a second physical drive
- The TSR tokens are small (< 10KB each) — even the full archive is likely < a few GB

---

### O5: API Key Stored in Plaintext in Environment or Logs

**What goes wrong:** The API key is set as `API_KEY=mysecretkey` in the Docker run command or docker-compose.yml and ends up in shell history, logs, or a public git repository.

**Prevention:**
- Use Docker secrets or an `.env` file that is `.gitignore`d
- Never log the Authorization header value
- Rotate the key if it's ever exposed

---

### O6: chattr +i/+a Does Not Work on All Unraid Filesystems

**What goes wrong:** You implement WORM-style protection using `chattr +i` (immutable) or `chattr +a` (append-only) on archive files. This silently does nothing on XFS filesystems (common in Unraid) or throws an error that is swallowed.

**Why it happens:** `chattr` extended attributes are an ext2/3/4 feature. XFS supports immutability via a different mechanism; the `+i` flag behavior varies. Unraid typically uses XFS for array drives.

**Consequences:** You believe files are immutable but they are not. `chattr +i` on XFS may succeed but have no effect, or may fail silently in a script.

**Prevention:**
- Do not rely on chattr for primary tamper protection on Unraid/XFS
- Rely instead on: filesystem permissions (read-only after write via chmod 444), SHA-256 hash verification on read, and the TSR as the cryptographic proof
- If WORM protection is needed: investigate ZFS datasets with `zfs set readonly=on` (Unraid supports ZFS since 6.12)

---

### O7: Time Drift on the Unraid Server

**What goes wrong:** The Unraid server's system clock is out of sync. The `metadata.json` submission timestamps are incorrect. This doesn't affect the TSR (the TSA provides the authoritative time), but it creates inconsistencies between the server's recorded submission time and the TSA's attested time.

**Why it happens:** NTP not configured, or NTP server unreachable.

**Consequences:** In a legal context, a 10-minute gap between server-recorded submission time and TSA-attested time could be questioned, even if explainable.

**Prevention:**
- Ensure NTP is configured on the Unraid host
- In `metadata.json`, record both the server time and the TSA-attested time from the TSR
- The TSA time is authoritative; the server time is informational

---

## Phase Mapping

Which pitfall to address in which build phase:

| Phase Topic | Pitfall | When to Address |
|-------------|---------|-----------------|
| File ingestion API | T4 (TSA unavailability), T3 (TSR not verified), O1 (no bind mount) | Phase 1 — foundation |
| TSQ/TSR generation | T1 (no -cert flag), T2 (hash mismatch), T5 (no .tsq stored) | Phase 1 — first TSR call |
| Docker/Unraid setup | O1, O2, O3, O6 | Phase 1 — deployment scaffolding |
| Metadata recording | L3 (chain of custody), L4 (provenance vs integrity) | Phase 1 — ingestion schema |
| Multi-TSA fallback | T4, L1, L2 | Phase 2 — reliability layer |
| iOS Shortcut integration | T7 (CF 100MB limit), T8 (header truncation), T9 (no status code) | Phase 2 or 3 — upload client |
| Certificate management | T1, T6 (revocation) | Phase 2 — long-term validity |
| Verification function | T3, T6 | Phase 3 — proof of correctness |
| Legal documentation | L1, L2, L4 | Phase 3 — user-facing docs |
| Security hardening | O5, T8 | Phase 1 (API key) + Phase 3 (audit) |
| Backup strategy | O4 | Phase 3 or post-v1 operational runbook |
| WORM / immutability | O6 | Post-v1 nice-to-have |

---

## Sources

- RFC 3161 specification: https://datatracker.ietf.org/doc/html/rfc3161
- OpenSSL RFC 3161 guided tour (implementation pitfalls): https://weisser-zwerg.dev/posts/trusted_timestamping/
- TSA server credibility list: https://gist.github.com/Manouchehri/fd754e402d98430243455713efada710
- eIDAS legal admissibility: https://snapoena.com/blog/rfc-3161-timestamps-what-courts-accept
- German qualified timestamp FAQ: https://signius.de/artikel/qualifizierte-elektronische-zeitstempel-faq/
- DFN-TSA non-commercial terms: https://doku.tid.dfn.de/de:dfnpki:zeitstempeldienst:faq
- Chain of custody digital evidence: https://truescreen.io/articles/digital-chain-custody-guide/
- Cloudflare Tunnel upload limits: https://community.cloudflare.com/t/100mb-tunnel-limit/901339
- Docker Unraid persistence: https://docs.unraid.net/unraid-os/troubleshooting/common-issues/docker-troubleshooting/
- Unraid 6.10 permission change: https://forums.unraid.net/bug-reports/stable-releases/docker-permission-issues-unraid-610-r1986/
- iOS Shortcuts API limitations: https://support.apple.com/guide/shortcuts/api-limitations-apd891a6c84e/ios
- iOS Shortcut Base64 header bug: https://discussions.apple.com/thread/251563782
- Paperless-ngx iOS shortcut issues: https://github.com/paperless-ngx/paperless-ngx/issues/2667
