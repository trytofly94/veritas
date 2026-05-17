#!/bin/sh
# verify.sh — auto-archive bundle integrity verifier
#
# Verifies that:
#   1. The SHA-256 in original.sha256 still matches the original.<ext> bytes.
#   2. The RFC 3161 timestamp in original.tsr is a valid signature over those
#      bytes, anchored at the CA chain in tsa-cacert.pem.
#
# Usage: from inside a bundle directory (or any copy of one), run `sh verify.sh`.
# Exits 0 on success with a clear message; non-zero on any failure.
#
# This script is intentionally POSIX sh (no bashisms): it must run on the
# minimal /bin/sh shipped by Debian (dash) and on macOS's BSD sh.
# The only external tools used are sha256sum OR shasum (macOS) and openssl.

set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# --- locate the single original.<ext> ---------------------------------------
# Glob original.* and filter out the sidecars (.sha256 .tsq .tsr).
ORIGINAL=""
for f in original.*; do
  case "$f" in
    original.sha256|original.tsq|original.tsr) ;;
    *)
      if [ -n "$ORIGINAL" ]; then
        echo "ERROR: more than one original.<ext> file found in bundle" >&2
        exit 4
      fi
      ORIGINAL="$f"
      ;;
  esac
done
if [ -z "$ORIGINAL" ] || [ ! -f "$ORIGINAL" ]; then
  echo "ERROR: original.<ext> file missing from bundle" >&2
  exit 4
fi

# --- choose hash tool -------------------------------------------------------
HASH_CMD=""
if command -v sha256sum >/dev/null 2>&1; then
  HASH_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  HASH_CMD="shasum -a 256"
else
  echo "ERROR: neither sha256sum nor shasum is installed" >&2
  exit 4
fi

# --- 1. SHA-256 check -------------------------------------------------------
if ! $HASH_CMD -c original.sha256 >/dev/null 2>&1; then
  echo "SHA256 MISMATCH: $ORIGINAL has changed since archive (or original.sha256 was tampered)"
  exit 2
fi

# --- 2. RFC 3161 signature check -------------------------------------------
if ! openssl ts -verify -in original.tsr -data "$ORIGINAL" -CAfile tsa-cacert.pem >/dev/null 2>&1; then
  echo "TIMESTAMP VERIFICATION FAILED: original.tsr does not verify against tsa-cacert.pem"
  exit 3
fi

echo "VERIFICATION SUCCESS: $ORIGINAL hashes match and timestamp is valid"
exit 0
