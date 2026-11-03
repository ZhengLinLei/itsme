#!/usr/bin/env bash
# Interactive terminal client for the REST API.
#   ./CLIENT.sh [--url URL] [--new] [--session-file FILE]

set -Eeuo pipefail

cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

BASE_URL="${API_URL:-http://localhost:${PORT:-3000}}"
SESSION_FILE="${ITSMe_SESSION_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/itsme/session.token}"
NEW_SESSION=false

usage() {
  cat <<'EOF'
Usage: ./CLIENT.sh [options]

Options:
  --url URL             API base URL (default: API_URL or http://localhost:3000)
  --new                 Ignore the saved session and create a new one
  --session-file FILE   Save the session token in FILE
  -h, --help            Show this help

Interactive commands:
  /history              Show the current conversation
  /new                  Start a new conversation
  /reset                Delete the current conversation and create another
  /quit, /exit          Close the client
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url)
      [ $# -ge 2 ] || { printf 'error: --url needs a value\n' >&2; exit 2; }
      BASE_URL="${2%/}"
      shift
      ;;
    --new) NEW_SESSION=true ;;
    --session-file)
      [ $# -ge 2 ] || { printf 'error: --session-file needs a value\n' >&2; exit 2; }
      SESSION_FILE="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

command -v curl >/dev/null 2>&1 || {
  printf 'error: curl is required\n' >&2
  exit 1
}
command -v python3 >/dev/null 2>&1 || {
  printf 'error: python3 is required to encode and decode API messages\n' >&2
  exit 1
}

if $NEW_SESSION; then
  rm -f "$SESSION_FILE"
fi

mkdir -p "$(dirname "$SESSION_FILE")"
umask 077
touch "$SESSION_FILE"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

request() {
  local method="$1" endpoint="$2" body="${3:-}" response_file="$TMP_DIR/response"
  local -a args=(--silent --show-error --request "$method" --output "$response_file" --write-out '%{http_code}' "$BASE_URL$endpoint")

  if [ -n "${API_KEY:-}" ]; then
    args+=(--header "authorization: Bearer $API_KEY")
  fi
  if [ -s "$SESSION_FILE" ]; then
    args+=(--header "x-session-token: $(cat "$SESSION_FILE")")
  fi
  if [ -n "$body" ]; then
    args+=(--header 'content-type: application/json' --data "$body")
  fi

  RESPONSE_STATUS="$(curl "${args[@]}")" || {
    printf 'error: could not reach %s\n' "$BASE_URL" >&2
    return 1
  }
  RESPONSE_BODY="$(cat "$response_file")"
}

json_value() {
  local field="$1"
  printf '%s' "$RESPONSE_BODY" | python3 -c '
import json
import sys

try:
    value = json.load(sys.stdin).get(sys.argv[1])
except (json.JSONDecodeError, AttributeError):
    value = None
if value is not None:
    print(value)
' "$field"
}

json_message() {
  python3 -c 'import json, sys; print(json.dumps(sys.argv[1], ensure_ascii=False))' "$1"
}

show_error() {
  local message
  message="$(json_value error || true)"
  [ -n "$message" ] || message="$RESPONSE_BODY"
  printf 'error (HTTP %s): %s\n' "$RESPONSE_STATUS" "$message" >&2
}

create_session() {
  request POST /api/session '{}'
  [ "$RESPONSE_STATUS" = 201 ] || { show_error; return 1; }
  json_value sessionToken >"$SESSION_FILE"
  [ -s "$SESSION_FILE" ] || {
    printf 'error: the server did not return a session token\n' >&2
    return 1
  }
  chmod 600 "$SESSION_FILE"
}

send_message() {
  local text="$1"
  request POST /api/chat "{\"message\":$(json_message "$text")}"
  if [ "$RESPONSE_STATUS" != 200 ]; then
    show_error
    return 1
  fi
  json_value reply
}

show_history() {
  request GET /api/session
  if [ "$RESPONSE_STATUS" != 200 ]; then
    show_error
    return 1
  fi
  printf '%s' "$RESPONSE_BODY" | python3 -c '
import json
import sys

data = json.load(sys.stdin)
for message in data.get("messages", []):
    role = "you" if message.get("role") == "user" else "assistant"
    content = message.get("content", "")
    print(f"{role}: {content}")
'
}

reset_session() {
  if [ -s "$SESSION_FILE" ]; then
    request DELETE /api/session
    [ "$RESPONSE_STATUS" = 200 ] || { show_error; return 1; }
  fi
  : >"$SESSION_FILE"
  create_session
}

if [ ! -s "$SESSION_FILE" ]; then
  create_session
fi

printf 'Chat client connected to %s\n' "$BASE_URL"
printf 'Type /help for commands, /quit to exit.\n\n'

while true; do
  if ! IFS= read -r -p 'you> ' message; then
    printf '\n'
    break
  fi
  case "$message" in
    '') continue ;;
    /quit|/exit) break ;;
    /help)
      usage
      ;;
    /history)
      show_history
      ;;
    /new)
      : >"$SESSION_FILE"
      create_session
      printf 'Started a new conversation.\n'
      ;;
    /reset)
      reset_session
      printf 'Conversation reset.\n'
      ;;
    *)
      if reply="$(send_message "$message")"; then
        printf 'assistant> %s\n' "$reply"
      fi
      ;;
  esac
done

printf 'Goodbye.\n'