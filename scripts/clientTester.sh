#!/usr/bin/env bash
# Tests the HTTP API against a running server.
#   API_URL=http://localhost:3000 API_KEY=... ADMIN_API_KEY=... ./scripts/clientTester.sh

set -Eeuo pipefail

BASE_URL="${API_URL:-http://localhost:3000}"
MESSAGE="${MESSAGE:-Hello}"
SESSION_TOKEN=""

cleanup() {
  [[ -n "${RESPONSE_FILE:-}" ]] && rm -f "$RESPONSE_FILE"
}
trap cleanup EXIT

# request METHOD ENDPOINT [JSON] [extra curl args...]
request() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"
  shift 3 2>/dev/null || shift $#

  RESPONSE_FILE="$(mktemp)"
  local -a curl_args=(
    --silent
    --show-error
    --output "$RESPONSE_FILE"
    --write-out "%{http_code}"
    --request "$method"
    "${BASE_URL}${endpoint}"
  )

  if [[ -n "${API_KEY:-}" ]]; then
    curl_args+=(-H "authorization: Bearer ${API_KEY}")
  fi
  if [[ -n "$SESSION_TOKEN" ]]; then
    curl_args+=(-H "x-session-token: ${SESSION_TOKEN}")
  fi
  if [[ -n "$data" ]]; then
    curl_args+=(-H "content-type: application/json" --data "$data")
  fi
  curl_args+=("$@")

  RESPONSE_STATUS="$(curl "${curl_args[@]}")"
  RESPONSE_BODY="$(cat "$RESPONSE_FILE")"
  rm -f "$RESPONSE_FILE"
  RESPONSE_FILE=""
}

expect_status() {
  local expected="$1"
  local description="$2"

  if [[ "$RESPONSE_STATUS" != "$expected" ]]; then
    printf 'FAIL %-32s expected HTTP %s, got %s\n' \
      "$description" "$expected" "$RESPONSE_STATUS" >&2
    printf '%s\n' "$RESPONSE_BODY" >&2
    exit 1
  fi
  printf 'OK   %s (HTTP %s)\n' "$description" "$RESPONSE_STATUS"
}

expect_body() {
  local pattern="$1"
  local description="$2"

  if ! grep -q "$pattern" <<<"$RESPONSE_BODY"; then
    printf 'FAIL %s: response does not contain %s\n%s\n' "$description" "$pattern" "$RESPONSE_BODY" >&2
    exit 1
  fi
}

json_field() {
  sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" <<<"$RESPONSE_BODY"
}

printf 'Testing API at %s\n\n' "$BASE_URL"

request GET /health
expect_status 200 "health"

request POST /api/session '{}'
expect_status 201 "create session"
SESSION_TOKEN="$(json_field sessionToken)"
[[ -n "$SESSION_TOKEN" ]] || { printf 'FAIL no sessionToken\n%s\n' "$RESPONSE_BODY" >&2; exit 1; }
printf '     sessionToken: %s...\n' "${SESSION_TOKEN:0:12}"

request POST /api/chat "{\"message\":\"${MESSAGE}\"}"
expect_status 200 "chat"
expect_body '"reply"' "chat"

request POST /api/chat "{\"message\":\"${MESSAGE}\",\"stream\":true}"
expect_status 200 "streaming chat"
expect_body 'event: done' "streaming chat"

request GET /api/session
expect_status 200 "session history"
expect_body '"messageCount":2' "session history"

SAVED_TOKEN="$SESSION_TOKEN"
SESSION_TOKEN="${SAVED_TOKEN%.*}.forged"
request POST /api/chat "{\"message\":\"${MESSAGE}\"}"
expect_status 401 "forged session token rejected"
SESSION_TOKEN="$SAVED_TOKEN"

request POST /api/chat '{"message":""}'
expect_status 400 "empty message rejected"

request POST /api/chat "{\"message\":\"${MESSAGE}\"}" -H 'origin: https://evil.example'
expect_status 403 "unknown origin rejected"

request POST /api/chat '' -H 'content-type: text/plain' --data "{\"message\":\"${MESSAGE}\"}"
expect_status 415 "non-JSON body rejected"

request GET /api/context
if [[ -n "${ADMIN_API_KEY:-}" ]]; then
  request GET /api/context '' -H "authorization: Bearer ${ADMIN_API_KEY}"
  expect_status 200 "admin context"
else
  expect_status 404 "admin route hidden"
fi

request DELETE /api/session
expect_status 200 "delete session"
request GET /api/session
expect_status 401 "deleted session is gone"

printf '\nAll client tests passed.\n'
