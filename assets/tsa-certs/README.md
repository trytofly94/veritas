# TSA CA Certificate Chains

This directory contains the CA certificate chains used to verify RFC 3161
timestamp responses (TSRs) from each configured TSA provider. These certs
are committed to the repo so that **offline verification** of every bundle
remains possible without depending on the live TSA service.

| File | Provider | Endpoint | Phase / Plan |
|------|----------|----------|--------------|
| `dfn.pem` | DFN-TSA (Deutsches Forschungsnetz) | https://zeitstempel.dfn.de | 01-01 (added), 01-02 (kept as primary) |
| `freetsa.pem` | FreeTSA | https://freetsa.org/tsr | 01-02 (fallback) |
| `digicert.pem` | DigiCert / rfc3161.ai.moda | TBD | 01-02 (tertiary) |

Plan 01-01 commits only `dfn.pem`. The other chains arrive with Plan 01-02.

## Source URLs

- **DFN-PKI Global Root CA (G2)** — published at
  <https://pki.pca.dfn.de/dfn-pki/> (look for `Global G2` root + intermediates).
  Chain composition is determined empirically per the procedure below — the
  live `ts -reply` output lists the exact signing cert + issuer DN, and that
  drives which intermediates we must commit. Avoid trusting the names
  alone — verify against the live TSR.
- **FreeTSA** — root: <https://freetsa.org/files/cacert.pem>;
  TSA signing cert: <https://freetsa.org/files/tsa.crt>.
- **DigiCert** — root + intermediate per DigiCert's published trust store
  at <https://www.digicert.com/kb/digicert-root-certificates.htm>.

## Live-TSA Chain Discovery Procedure (used in Plan 01-01)

For each TSA we commit a chain that has been **proven** to verify a real
response from that TSA. The procedure:

1. Compute a representative SHA-256 digest (e.g., of any small file):
   ```bash
   echo -n "auto-archive cert discovery" | openssl dgst -sha256 -binary | xxd -p -c 64 > /tmp/digest.hex
   ```
2. Build a TimeStampQuery with a nonce (do NOT use `-no_nonce`):
   ```bash
   openssl ts -query -digest "$(cat /tmp/digest.hex)" -sha256 -cert -out /tmp/query.tsq
   ```
3. Send the query to the live TSA and capture the response:
   ```bash
   curl -sS -H 'Content-Type: application/timestamp-query' \
        --data-binary @/tmp/query.tsq \
        https://zeitstempel.dfn.de \
        -o /tmp/reply.tsr
   ```
4. Inspect the TSR — note the signing cert subject + every issuer in the chain:
   ```bash
   openssl ts -reply -in /tmp/reply.tsr -text | sed -n '/Certificate:/,/-----END/p'
   ```
5. Fetch the named root + intermediate(s) from the issuer's published trust
   store (sources above), concatenate root + intermediates into the PEM file:
   ```bash
   cat dfn-root.pem dfn-intermediate.pem > assets/tsa-certs/dfn.pem
   ```
6. Prove the chain verifies BEFORE committing:
   ```bash
   openssl ts -verify -in /tmp/reply.tsr -queryfile /tmp/query.tsq \
              -CAfile assets/tsa-certs/dfn.pem
   # expected: "Verification: OK" and exit 0
   ```
7. Record fingerprints (next section) so any future cert swap is auditable.

If step 6 fails, the chain is incomplete — fetch the missing intermediate
named in step 4, append it, and retry. **Never commit a guessed cert** —
if the live endpoint is unreachable during the chain-build, surface that
as a checkpoint instead of guessing.

## Fingerprint Verification Procedure

For every cert in every committed PEM chain, record the SHA-256 fingerprint
plus subject + issuer below. This gives any future maintainer a way to
confirm a cert swap was intentional and matches the issuer's published
authoritative copy.

```bash
# For each cert in a chain:
openssl x509 -in <cert.pem> -noout -fingerprint -sha256 -subject -issuer
```

Compare each fingerprint against the issuer's published fingerprint (DFN-PKI
website, DigiCert trust store page, etc.). Update this file whenever the
chain changes.

## Recorded Fingerprints

### dfn.pem

Chain (in PEM order): **root → CA 2 → Global Issuing CA**.
The signing cert (`PN: Zeitstempel 2023`) is embedded in every TSR returned
by DFN and is therefore intentionally NOT included here.

```
Cert 0 (root) — T-TeleSec GlobalRoot Class 2
  subject:     C=DE, O=T-Systems Enterprise Services GmbH, OU=T-Systems Trust Center, CN=T-TeleSec GlobalRoot Class 2
  issuer:      C=DE, O=T-Systems Enterprise Services GmbH, OU=T-Systems Trust Center, CN=T-TeleSec GlobalRoot Class 2
  sha256:      91:E2:F5:78:8D:58:10:EB:A7:BA:58:73:7D:E1:54:8A:8E:CA:CD:01:45:98:BC:0B:14:3E:04:1B:17:05:25:52

Cert 1 (intermediate) — DFN-Verein Certification Authority 2
  subject:     C=DE, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., OU=DFN-PKI, CN=DFN-Verein Certification Authority 2
  issuer:      C=DE, O=T-Systems Enterprise Services GmbH, OU=T-Systems Trust Center, CN=T-TeleSec GlobalRoot Class 2
  sha256:      F6:60:B0:C2:56:48:1C:B2:BF:C6:76:61:C1:EA:8F:EE:E3:95:B7:14:1B:CA:C3:6C:36:E0:4D:08:CD:9E:15:82

Cert 2 (intermediate) — DFN-Verein Global Issuing CA
  subject:     C=DE, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., OU=DFN-PKI, CN=DFN-Verein Global Issuing CA
  issuer:      C=DE, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., OU=DFN-PKI, CN=DFN-Verein Certification Authority 2
  sha256:      12:57:AA:C2:F4:EE:AC:6C:A4:94:2C:2C:83:F0:B6:7B:41:A3:B4:71:20:C4:D5:34:29:92:95:13:AC:AD:46:8C
```

Signing cert (embedded in TSRs, recorded here for audit):

```
Signing cert — PN: Zeitstempel 2023
  subject:     C=DE, ST=Berlin, L=Berlin, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., OU=Geschaeftsstelle, pseudonym=Zeitstempel 2023, CN=PN: Zeitstempel 2023
  issuer:      C=DE, O=Verein zur Foerderung eines Deutschen Forschungsnetzes e. V., OU=DFN-PKI, CN=DFN-Verein Global Issuing CA
  sha256:      B6:08:8D:BD:DD:08:98:D3:49:07:8D:7C:23:32:A7:4E:CC:84:14:0C:A0:83:59:F0:23:57:25:46:CF:6E:82:E4
```

**Live verification proof** (executed 2026-05-17 against live DFN-TSA):

```
$ openssl ts -verify -in reply.tsr -queryfile query.tsq -CAfile assets/tsa-certs/dfn.pem
Verification: OK
```

DFN round-trip latency observed: ~217 ms (single sample, no SLA).

**Discovery source:** All four certs were extracted via pkijs from a real
TSR returned by `https://zeitstempel.dfn.de` (the embedded `certificates`
SET inside the SignedData). This is preferable to fetching from DFN-PKI's
website because it guarantees the committed chain matches what the live
service currently signs with. Re-run the procedure when DFN rotates certs.

### freetsa.pem

_Added in Plan 01-02._

### digicert.pem

_Added in Plan 01-02._
