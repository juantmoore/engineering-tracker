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
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -- "-$pid" 2>/dev/null; done
  rm -rf "$WORK"
}

# bg LOG CMD...: start CMD in its own process group so cleanup also stops its children.
bg() {
  local log="$1"; shift
  setsid "$@" >"$log" 2>&1 &
  PIDS+=($!)
}

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
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
  port_free "$APP_PORT" || { echo "port $APP_PORT is already in use; stop that process first"; exit 1; }
  bg "$WORK/app.log" node_modules/.bin/next start -p "$APP_PORT"
  wait_for "$APP/"
}

verify_scaffold() {
  section "scaffold"
  http GET /
  check "GET / returns 200" '[ "$STATUS" = 200 ]'
  check "page title is Engineering Tracker" 'grep -q "<title>Engineering Tracker</title>" <<<"$BODY"'
}

REDIS_PORT="${REDIS_PORT:-6390}"
SHIM_PORT="${SHIM_PORT:-8079}"
SHIM_TOKEN="fake-shim-token-$(openssl rand -hex 8)"

start_redis() {
  command -v redis-server >/dev/null || { echo "redis-server not installed; skipping Redis checks"; return 1; }
  port_free "$REDIS_PORT" && port_free "$SHIM_PORT" || { echo "redis or shim port in use"; return 1; }
  bg "$WORK/redis.log" redis-server --port "$REDIS_PORT" --save "" --appendonly no
  bg "$WORK/shim.log" env REDIS_URL="redis://127.0.0.1:$REDIS_PORT" SHIM_PORT="$SHIM_PORT" SHIM_TOKEN="$SHIM_TOKEN" \
    node scripts/upstash-rest-shim.mjs
  for _ in $(seq 1 40); do grep -q "upstash shim" "$WORK/shim.log" && return 0; sleep 0.25; done
  return 1
}

verify_store() {
  section "store (real redis-server through the Upstash REST protocol)"
  if [ -z "$REDIS_UP" ]; then fail "redis-server available"; return; fi
  if TEST_REDIS_REST_URL="http://127.0.0.1:$SHIM_PORT" TEST_REDIS_REST_TOKEN="$SHIM_TOKEN" \
    npx vitest run tests/store.test.ts >"$WORK/store.log" 2>&1; then
    pass "store suite passes on memory and redis backends"
  else
    fail "store suite on redis"; tail -30 "$WORK/store.log"
  fi
  show "$(grep -E 'Tests' "$WORK/store.log")"
}

ARTIFACTS_DIR="${ARTIFACTS_DIR:-artifacts}"
RECEIVER_PORT="${RECEIVER_PORT:-4123}"
RECEIVER="http://127.0.0.1:${RECEIVER_PORT}"
export AGENT_WEBHOOK_URL="$RECEIVER/jira/events"
export WEBHOOK_RETRY_DELAYS_MS="${WEBHOOK_RETRY_DELAYS_MS:-300,600}"

start_receiver() {
  port_free "$RECEIVER_PORT" || { echo "port $RECEIVER_PORT is already in use"; exit 1; }
  bg "$WORK/receiver.log" env RECEIVER_PORT="$RECEIVER_PORT" node scripts/receiver.mjs
  wait_for "$RECEIVER/__requests"
}

# Runs scripts/ui-check.mjs and folds its PASS/FAIL lines into the totals.
run_ui_check() {
  APP_URL="$APP" RECEIVER_URL="$RECEIVER" EXPECT_WEBHOOK_SECRET="$TRACKER_WEBHOOK_SECRET" ARTIFACTS_DIR="$ARTIFACTS_DIR" \
    node scripts/ui-check.mjs >"$WORK/ui.log" 2>&1
  cat "$WORK/ui.log"
  PASSED=$((PASSED + $(grep -c '^  PASS' "$WORK/ui.log")))
  FAILED=$((FAILED + $(grep -c '^  FAIL' "$WORK/ui.log")))
  if ! grep -qE '^  (PASS|FAIL)' "$WORK/ui.log"; then fail "ui-check produced results"; fi
}

verify_board() {
  section "board and webhooks (headless Chrome + local receiver, evidence in $ARTIFACTS_DIR/)"
  http GET /
  check "server-rendered board contains WIT-10 and WIT-17" 'grep -q "WIT-10" <<<"$BODY" && grep -q "WIT-17" <<<"$BODY"'
  run_ui_check
}

REDIS_UP=""
start_redis && REDIS_UP=1
if [ "$TRACKER_STORE" = redis ] && [ -n "$REDIS_UP" ]; then
  unset TRACKER_STORE
  export KV_REST_API_URL="http://127.0.0.1:$SHIM_PORT" KV_REST_API_TOKEN="$SHIM_TOKEN"
fi

start_receiver
start_app
verify_scaffold
verify_store
verify_board

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
