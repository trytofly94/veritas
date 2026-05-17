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

_Populated by the Plan 01-01 executor after the live-TSA chain-discovery
procedure above succeeds. Each cert in the chain is recorded as:_

```
Cert N (subject):    CN=...
Cert N (issuer):     CN=...
Cert N fingerprint:  SHA256 Fingerprint=XX:XX:...
```

_Plus a recorded `openssl ts -verify ... → Verification: OK` line proving
the committed chain verifies a live TSR._

### freetsa.pem

_Added in Plan 01-02._

### digicert.pem

_Added in Plan 01-02._
