#!/bin/sh
# smoke-container.sh — Phase 1 Plan 01-03 automated container smoke test.
#
# Builds the image, runs the service via docker compose, POSTs a fixture file,
# asserts the bundle lands on the host bind-mounted ./data volume with the
# required 7 CORE-03 files, runs the embedded verify.sh on the host, asserts
# the container does NOT carry its own /app/data dir (bundle-isolation check
# from CONCERN-4), and tears down the container.
#
# Exits 0 on success, non-zero (with a clear FAIL message) on any deviation.
# POSIX sh / dash compatible. stat invocations use dual Linux/macOS form.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

CONTAINER_NAME="veritas"
PORT="3700"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
UPLOAD_URL="http://127.0.0.1:${PORT}/api/upload"
FIXTURE="tests/fixtures/hello.txt"
DATA_DIR="./data"
# Phase 2: API key used by the smoke upload request (matches docker-compose.yml default)
SMOKE_API_KEY="${API_KEY:-smoke-test-api-key-change-in-production}"

log() { printf '[smoke] %s\n' "$*" >&2; }
fail() { printf '[smoke] FAIL: %s\n' "$*" >&2; exit 1; }

cleanup() {
  log "tearing down compose stack"
  docker compose down --remove-orphans >/dev/null 2>&1 || true
}
# Always tear down — even on early failure — so re-runs start clean.
trap cleanup EXIT INT TERM

[ -f "$FIXTURE" ] || fail "missing fixture: $FIXTURE"

log "removing stale container if any"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

log "wiping ./data for a clean baseline"
# Note: rm -rf, not git clean — this script is allowed to clean its own data dir.
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

log "docker compose build"
docker compose build

log "docker compose up -d"
docker compose up -d

log "asserting container_name is pinned to '${CONTAINER_NAME}' (CONCERN-4)"
RUNNING_NAME="$(docker ps --filter "name=^${CONTAINER_NAME}\$" --format '{{.Names}}')"
[ "$RUNNING_NAME" = "$CONTAINER_NAME" ] \
  || fail "expected running container name '${CONTAINER_NAME}', got '${RUNNING_NAME}'"

log "polling ${HEALTH_URL} for up to 30s (Node fetch — parity with HEALTHCHECK)"
i=0
while [ "$i" -lt 30 ]; do
  if node -e "fetch('${HEALTH_URL}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    log "health endpoint is up after ${i}s"
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$i" -ge 30 ]; then
  log "container did not become healthy in 30s — dumping logs"
  docker compose logs --tail=200 || true
  fail "health endpoint never returned 200"
fi

log "POSTing fixture to ${UPLOAD_URL}"
RESPONSE_FILE="$(mktemp)"
HTTP_STATUS="$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' \
  -H "X-API-Key: ${SMOKE_API_KEY}" \
  -F "file=@${FIXTURE}" -F "label=smoke" "$UPLOAD_URL")"
[ "$HTTP_STATUS" = "201" ] \
  || { cat "$RESPONSE_FILE" >&2; fail "expected HTTP 201, got ${HTTP_STATUS}"; }

# Extract id + bundle_path without depending on jq (slim hosts may lack it).
BUNDLE_ID="$(node -e "
  const r = JSON.parse(require('node:fs').readFileSync('${RESPONSE_FILE}','utf8'));
  if(!r.id) process.exit(2);
  process.stdout.write(r.id);
")"
BUNDLE_PATH_IN_CONTAINER="$(node -e "
  const r = JSON.parse(require('node:fs').readFileSync('${RESPONSE_FILE}','utf8'));
  process.stdout.write(r.bundle_path || '');
")"
rm -f "$RESPONSE_FILE"

[ -n "$BUNDLE_ID" ] || fail "response body did not contain an id"
log "server reported bundle id=${BUNDLE_ID} container_path=${BUNDLE_PATH_IN_CONTAINER}"

# Map container path /data/<id> to host path ./data/<id>.
case "$BUNDLE_PATH_IN_CONTAINER" in
  /data/*) HOST_BUNDLE="${DATA_DIR}/${BUNDLE_PATH_IN_CONTAINER#/data/}" ;;
  *) fail "bundle_path '${BUNDLE_PATH_IN_CONTAINER}' is not under /data" ;;
esac

[ -d "$HOST_BUNDLE" ] \
  || fail "bundle dir did not appear on host bind mount: ${HOST_BUNDLE}"

log "asserting bundle contains exactly 7 files"
FILE_COUNT="$(find "$HOST_BUNDLE" -maxdepth 1 -mindepth 1 -type f | wc -l | tr -d ' ')"
[ "$FILE_COUNT" = "7" ] \
  || { ls -la "$HOST_BUNDLE" >&2; fail "expected 7 files in bundle, found ${FILE_COUNT}"; }

# Spot-check key artifacts and modes (dual Linux + macOS stat form per acceptance).
for f in original.txt original.sha256 original.tsq original.tsr tsa-cacert.pem metadata.json verify.sh; do
  [ -e "${HOST_BUNDLE}/${f}" ] || fail "missing bundle artifact: ${f}"
done

VERIFY_MODE="$(stat -c %a "${HOST_BUNDLE}/verify.sh" 2>/dev/null || stat -f %Lp "${HOST_BUNDLE}/verify.sh")"
[ "$VERIFY_MODE" = "555" ] \
  || fail "verify.sh mode is ${VERIFY_MODE}, expected 555"

ORIG_MODE="$(stat -c %a "${HOST_BUNDLE}/original.txt" 2>/dev/null || stat -f %Lp "${HOST_BUNDLE}/original.txt")"
[ "$ORIG_MODE" = "444" ] \
  || fail "original.txt mode is ${ORIG_MODE}, expected 444"

log "running bundle verify.sh on the host (host openssl, not container openssl)"
VERIFY_OUTPUT="$(bash "${HOST_BUNDLE}/verify.sh" 2>&1)"
echo "$VERIFY_OUTPUT" | grep -q "VERIFICATION SUCCESS" \
  || { echo "$VERIFY_OUTPUT" >&2; fail "verify.sh did not print VERIFICATION SUCCESS"; }

log "container-bundle-isolation check (CONCERN-4): no /app/data inside container"
docker compose exec -T "$CONTAINER_NAME" sh -c '[ ! -e /app/data ]' \
  || fail "/app/data exists inside the container — bundles must live ONLY on the host bind mount"

log "docker compose down (verify data survives)"
docker compose down

[ -d "$HOST_BUNDLE" ] \
  || fail "bundle dir disappeared after compose down: ${HOST_BUNDLE}"

# trap-cleanup will run again but is idempotent.
trap - EXIT INT TERM
cleanup

log "OK — container smoke passed (bundle ${BUNDLE_ID} verified on host)"
