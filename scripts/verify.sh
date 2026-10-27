#!/usr/bin/env bash
# End-to-end checks against a real production build of the app.
#
#   scripts/verify.sh               build, start the app, run every section
#   SKIP_BUILD=1 scripts/verify.sh  reuse the existing .next build
#
# Secrets are random fake values generated per run. Nothing here is a real credential.
set -uo pipefail
cd "$(dirname "$0")/.."

APP_PORT="${APP_PORT:-3123}"
APP="http://127.0.0.1:${APP_PORT}"
WORK="$(mktemp -d)"

export TRACKER_STORE="${TRACKER_STORE:-memory}"
export TRACKER_BASE_URL="$APP"
export TRACKER_API_KEY="fake-api-key-$(openssl rand -hex 8)"
export TRACKER_WEBHOOK_SECRET="fake-webhook-secret-$(openssl rand -hex 8)"
export CRON_SECRET="fake-cron-secret-$(openssl rand -hex 8)"

PASSED=0
FAILED=0
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
  rm -rf "$WORK"
}
trap cleanup EXIT

section() { printf '\n== %s ==\n' "$1"; }
pass() { PASSED=$((PASSED + 1)); printf '  PASS  %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL  %s\n' "$1"; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
show() { printf '        %s\n' "$@"; }

# http METHOD PATH [curl args...]: sets $STATUS and $BODY
http() {
  local method="$1" path="$2"; shift 2
  STATUS=$(curl -s -o "$WORK/body" -w '%{http_code}' -X "$method" "$@" "$APP$path")
  BODY=$(cat "$WORK/body")
}

wait_for() {
  local url="$1"
  for _ in $(seq 1 60); do curl -s -o /dev/null "$url" && return 0; sleep 0.5; done
  echo "timed out waiting for $url"; exit 1
}

start_app() {
  if [ -z "${SKIP_BUILD:-}" ]; then
    section "build"
    if npm run build >"$WORK/build.log" 2>&1; then pass "next build"; else fail "next build"; tail -40 "$WORK/build.log"; exit 1; fi
  fi
  npx next start -p "$APP_PORT" >"$WORK/app.log" 2>&1 &
  PIDS+=($!)
  wait_for "$APP/"
}

verify_scaffold() {
  section "scaffold"
  http GET /
  check "GET / returns 200" '[ "$STATUS" = 200 ]'
  check "page title is Engineering Tracker" 'grep -q "<title>Engineering Tracker</title>" <<<"$BODY"'
}

start_app
verify_scaffold

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
