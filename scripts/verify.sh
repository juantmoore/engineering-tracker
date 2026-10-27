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
show() { printf '%s\n' "$@" | sed 's/^/        /'; }

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

verify_static() {
  section "lint, typecheck, unit tests"
  local step
  for step in lint typecheck test; do
    if npm run "$step" >"$WORK/$step.log" 2>&1; then pass "npm run $step"; else fail "npm run $step"; tail -30 "$WORK/$step.log"; fi
  done
  show "$(grep -E '^ +(Test Files|Tests) ' "$WORK/test.log")"
}

start_app() {
  if [ -z "${SKIP_BUILD:-}" ]; then
    section "build"
    if npm run build >"$WORK/build.log" 2>&1; then pass "next build"; else fail "next build"; tail -40 "$WORK/build.log"; exit 1; fi
  fi
  port_free "$APP_PORT" || { echo "port $APP_PORT is already in use; stop that process first"; exit 1; }
  bg "$WORK/app.log" node_modules/.bin/next start -p "$APP_PORT"
  APP_PID=$!
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

# api LABEL METHOD PATH AUTH [JSON]: curl the API, print the exchange, set $STATUS/$BODY.
# AUTH is none, bad or good. The real key is never printed.
api() {
  local label="$1" method="$2" path="$3" auth="$4" data="${5:-}" shown
  local args=(-H "Content-Type: application/json")
  case "$auth" in
    good) args+=(-H "Authorization: Bearer $TRACKER_API_KEY"); shown=' -H "Authorization: Bearer $TRACKER_API_KEY"' ;;
    bad) args+=(-H "Authorization: Bearer not-the-key"); shown=' -H "Authorization: Bearer not-the-key"' ;;
    *) shown="" ;;
  esac
  [ -n "$data" ] && args+=(-d "$data")
  http "$method" "$path" "${args[@]}"
  {
    printf '$ curl -X %s %s%s%s\n' "$method" "$path" "$shown" "${data:+ -d '$data'}"
    printf '%s %s\n\n' "$STATUS" "$(jq -c . <<<"$BODY" 2>/dev/null || echo "$BODY")"
  } | tee -a "$ARTIFACTS_DIR/api-curl.txt" | cut -c1-400 | sed '/^$/d; s/^/        /'
  : "$label"
}

receiver_count() { curl -s "$RECEIVER/__requests" | jq length; }

verify_api() {
  section "write-back API (curl)"
  : >"$ARTIFACTS_DIR/api-curl.txt"
  curl -s -X POST "$RECEIVER/__reset" >/dev/null

  api "comment, no key" POST /api/issues/WIT-12/comments none '{"body":"hi","author":"workit-agent"}'
  check "comments: 401 with no key" '[ "$STATUS" = 401 ] && [ "$(jq -r .error <<<"$BODY")" != null ]'
  api "comment, bad key" POST /api/issues/WIT-12/comments bad '{"body":"hi","author":"workit-agent"}'
  check "comments: 401 with a bad key" '[ "$STATUS" = 401 ]'
  api "assignee, no key" PUT /api/issues/WIT-12/assignee none '{"accountId":"u-sam"}'
  check "assignee: 401 with no key" '[ "$STATUS" = 401 ]'
  api "assignee, bad key" PUT /api/issues/WIT-12/assignee bad '{"accountId":"u-sam"}'
  check "assignee: 401 with a bad key" '[ "$STATUS" = 401 ]'
  api "transition, bad key" POST /api/issues/WIT-12/transitions bad '{"status":"Done"}'
  check "transitions: 401 with a bad key" '[ "$STATUS" = 401 ]'
  api "list, no key" GET /api/issues none
  check "GET /api/issues: 401 with no key" '[ "$STATUS" = 401 ]'
  sleep 1
  check "rejected calls fired no webhook" '[ "$(receiver_count)" = 0 ]'

  api "list" GET /api/issues good
  check "GET /api/issues: 200 with 8 issues" '[ "$STATUS" = 200 ] && [ "$(jq ".issues | length" <<<"$BODY")" = 8 ]'
  api "users" GET /api/users good
  check "GET /api/users: 200 with users" '[ "$STATUS" = 200 ] && jq -e ".users[] | select(.accountId == \"u-sam\")" <<<"$BODY" >/dev/null'

  api "comment" POST /api/issues/WIT-12/comments good '{"body":"Reviewed the rate limiter, looks good.","author":"workit-agent"}'
  check "comments: 201 with the Comment" '[ "$STATUS" = 201 ] && jq -e ".id and .created and .author == \"workit-agent\"" <<<"$BODY" >/dev/null'
  api "assignee" PUT /api/issues/WIT-12/assignee good '{"accountId":"u-sam"}'
  check "assignee: 200 and Issue assigned to u-sam" '[ "$STATUS" = 200 ] && [ "$(jq -r .assignee.accountId <<<"$BODY")" = u-sam ]'
  api "unassign" PUT /api/issues/WIT-12/assignee good '{"accountId":null}'
  check "assignee: null unassigns" '[ "$STATUS" = 200 ] && [ "$(jq -r .assignee <<<"$BODY")" = null ]'
  api "transition" POST /api/issues/WIT-12/transitions good '{"status":"Done"}'
  check "transitions: 200 and Issue moved to Done" '[ "$STATUS" = 200 ] && [ "$(jq -r .status <<<"$BODY")" = Done ]'
  api "get" GET /api/issues/WIT-12 good
  check "GET /api/issues/WIT-12 reflects the comment and transition" \
    '[ "$(jq -r .status <<<"$BODY")" = Done ] && jq -e ".comments[-1].body | startswith(\"Reviewed\")" <<<"$BODY" >/dev/null'

  api "unknown issue" GET /api/issues/WIT-999 good
  check "unknown issue: 404 with error" '[ "$STATUS" = 404 ] && jq -e .error <<<"$BODY" >/dev/null'
  api "bad status" POST /api/issues/WIT-12/transitions good '{"status":"Shipped"}'
  check "bad status: 400 with error" '[ "$STATUS" = 400 ] && jq -e .error <<<"$BODY" >/dev/null'
  api "unknown user" PUT /api/issues/WIT-12/assignee good '{"accountId":"u-ghost"}'
  check "unknown user: 400" '[ "$STATUS" = 400 ]'

  sleep 1.5
  local hooks; hooks=$(curl -s "$RECEIVER/__requests")
  check "API writes fired 3 webhooks (assign, unassign, transition), user = the agent" \
    '[ "$(jq length <<<"$hooks")" = 3 ] && [ "$(jq -r "[.[].body.user.accountId] | unique | join(\",\")" <<<"$hooks")" = workit-agent ]'
  show "$(jq -c '.[] | {eventId: .body.eventId, user: .body.user.displayName, change: .body.changelog.items[0] | "\(.field): \(.fromString) -> \(.toString)"}' <<<"$hooks")"
}

statuses() { curl -s -H "Authorization: Bearer $TRACKER_API_KEY" "$APP/api/issues" | jq -r '.issues[] | "\(.key)=\(.status)"'; }

verify_cron() {
  section "auto mode cron (curl /api/cron/auto)"
  local before after diff hooks
  http GET /api/cron/auto
  show "no Authorization header -> $STATUS $BODY"
  check "cron: 401 without CRON_SECRET" '[ "$STATUS" = 401 ]'
  http GET /api/cron/auto -H "Authorization: Bearer not-the-secret"
  show "wrong secret -> $STATUS $BODY"
  check "cron: 401 with the wrong secret" '[ "$STATUS" = 401 ]'

  before=$(statuses)
  http GET /api/cron/auto -H "Authorization: Bearer $CRON_SECRET"
  show "auto mode off -> $STATUS $BODY"
  check "cron with auto mode off: 200, skipped, board unchanged" \
    '[ "$STATUS" = 200 ] && jq -e ".skipped" <<<"$BODY" >/dev/null && [ "$(statuses)" = "$before" ]'

  if APP_URL="$APP" AUTO_MODE=on ARTIFACTS_DIR="$ARTIFACTS_DIR" node scripts/ui-auto-mode.mjs >"$WORK/auto.log" 2>&1; then :; fi
  sed -n '1,2p' "$WORK/auto.log"
  PASSED=$((PASSED + $(grep -c '^  PASS' "$WORK/auto.log"))); FAILED=$((FAILED + $(grep -c '^  FAIL' "$WORK/auto.log")))

  for run in 1 2 3; do
    curl -s -X POST "$RECEIVER/__reset" >/dev/null
    before=$(statuses)
    http GET /api/cron/auto -H "Authorization: Bearer $CRON_SECRET"
    after=$(statuses)
    diff=$(diff <(echo "$before") <(echo "$after") | grep '^[<>]' || true)
    sleep 1
    hooks=$(curl -s "$RECEIVER/__requests")
    show "run $run -> $STATUS $BODY" "before/after:" "$diff"
    check "cron run $run moved exactly one ticket to a different status" \
      '[ "$STATUS" = 200 ] && [ "$(grep -c "^<" <<<"$diff")" = 1 ] && [ "$(grep -c "^>" <<<"$diff")" = 1 ] && grep -q "$(jq -r .moved.key <<<"$BODY")=" <<<"$diff"'
    check "cron run $run fired exactly one webhook from Auto mode" \
      '[ "$(jq length <<<"$hooks")" = 1 ] && [ "$(jq -r ".[0].body.user.displayName" <<<"$hooks")" = "Auto mode" ]'
  done
}

verify_restart() {
  section "persistence across a server restart (Redis store)"
  local before after
  before=$(statuses)
  kill -- "-$APP_PID" 2>/dev/null
  for _ in $(seq 1 40); do port_free "$APP_PORT" && break; sleep 0.25; done
  SKIP_BUILD=1 start_app
  after=$(statuses)
  show "store badge: $(curl -s "$APP/" | grep -o 'Upstash Redis\|In-memory store' | head -1)"
  check "board state survives a restart of the app process" '[ -n "$before" ] && [ "$before" = "$after" ]'
}

REDIS_UP=""
start_redis && REDIS_UP=1
if [ "$TRACKER_STORE" = redis ] && [ -n "$REDIS_UP" ]; then
  unset TRACKER_STORE
  export KV_REST_API_URL="http://127.0.0.1:$SHIM_PORT" KV_REST_API_TOKEN="$SHIM_TOKEN"
fi

USING_REDIS=""
[ -n "${KV_REST_API_URL:-}" ] && USING_REDIS=1
if [ -n "$USING_REDIS" ]; then echo "app store: redis-server via the Upstash REST shim"; else echo "app store: in-memory"; fi

[ -z "${SKIP_BUILD:-}" ] && verify_static
start_receiver
start_app
verify_scaffold
verify_store
verify_board
verify_api
verify_cron
[ -n "$USING_REDIS" ] && verify_restart

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
