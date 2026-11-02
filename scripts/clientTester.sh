#!/usr/bin/env bash

set -Eeuo pipefail

BASE_URL="${API_URL:-http://localhost:3000}"
MESSAGE="${MESSAGE:-Hello}"
AUTH_HEADER=()

if [[ -n "${API_KEY:-}" ]]; then
  AUTH_HEADER=(-H "authorization: Bearer ${API_KEY}")
fi

cleanup() {
  [[ -n "${RESPONSE_FILE:-}" ]] && rm -f "$RESPONSE_FILE"
}
trap cleanup EXIT

request() {
  local method="$1"
  local endpoint="$2"
  local data="${3:-}"

  RESPONSE_FILE="$(mktemp)"
  local -a curl_args=(
    --silent
    --show-error
    --output "$RESPONSE_FILE"
    --write-out "%{http_code}"
    --request "$method"
    "${BASE_URL}${endpoint}"
  )

  if [[ ${#AUTH_HEADER[@]} -gt 0 ]]; then
    curl_args+=("${AUTH_HEADER[@]}")
  fi

  if [[ -n "$data" ]]; then
    curl_args+=(-H "content-type: application/json" --data "$data")
  fi

  RESPONSE_STATUS="$(curl "${curl_args[@]}")"
  RESPONSE_BODY="$(cat "$RESPONSE_FILE")"
  rm -f "$RESPONSE_FILE"
  RESPONSE_FILE=""
}

expect_status() {
  local expected="$1"
  local description="$2"

  if [[ "$RESPONSE_STATUS" != "$expected" ]]; then
    printf 'FAIL %-28s expected HTTP %s, got %s\n' \
      "$description" "$expected" "$RESPONSE_STATUS" >&2
    printf '%s\n' "$RESPONSE_BODY" >&2
    exit 1
  fi
  printf 'OK   %s (HTTP %s)\n' "$description" "$RESPONSE_STATUS"
}

printf 'Testing API at %s\n\n' "$BASE_URL"

request GET /health
expect_status 200 "health"

request GET /api/context
expect_status 200 "context"

request POST /api/chat "{\"message\":\"${MESSAGE}\"}"
expect_status 200 "chat"

conversation_id="$(printf '%s' "$RESPONSE_BODY" |
  sed -n 's/.*"conversationId":"\([^"]*\)".*/\1/p')"
if [[ -z "$conversation_id" ]]; then
  printf 'FAIL chat response does not contain a conversationId\n%s\n' "$RESPONSE_BODY" >&2
  exit 1
fi
printf '     conversationId: %s\n' "$conversation_id"

request POST /api/chat "{\"message\":\"${MESSAGE}\",\"conversationId\":\"${conversation_id}\",\"stream\":true}"
expect_status 200 "streaming chat"
if ! grep -q '"done":true' <<<"$RESPONSE_BODY"; then
  printf 'FAIL streaming chat response does not contain a done event\n%s\n' \
    "$RESPONSE_BODY" >&2
  exit 1
fi

request DELETE "/api/conversations?id=${conversation_id}"
expect_status 200 "delete conversation"
if ! grep -q '"deleted":true' <<<"$RESPONSE_BODY"; then
  printf 'FAIL conversation was not deleted\n%s\n' "$RESPONSE_BODY" >&2
  exit 1
fi

printf '\nAll client tests passed.\n'
