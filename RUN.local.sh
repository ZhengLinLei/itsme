#!/usr/bin/env bash
# Run everything locally, without Docker: installs what is missing, starts a native Ollama
# (GPU/Metal on macOS, much faster than Ollama inside Docker on a Mac), downloads the model,
# builds the API and starts it.
#   ./RUN.local.sh                 -> install if needed, build and start (http://localhost:3000)
#   ./RUN.local.sh --dev           -> start with hot reload (tsx watch) instead of a build
#   ./RUN.local.sh --model NAME    -> use another Ollama model (overrides LLM_MODEL)
#   ./RUN.local.sh -y              -> install missing tools without asking
#   ./RUN.local.sh --no-install    -> never install anything, only check
# Reads .env like RUN.sh. Sessions are stored in ./data, Ollama logs in ./data/ollama.log.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

DEV=false
ASSUME_YES=false
INSTALL=true

while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV=true ;;
    --model) LLM_MODEL="$2"; shift ;;
    -y|--yes) ASSUME_YES=true ;;
    --no-install) INSTALL=false ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

export PORT="${PORT:-3000}"
export LLM_PROVIDER="${LLM_PROVIDER:-ollama}"
export LLM_MODEL="${LLM_MODEL:-qwen2.5:3b}"
export CONTEXT_FILE="${LOCAL_CONTEXT_FILE:-$PWD/context/context.txt}"
export DATA_DIR="${LOCAL_DATA_DIR:-$PWD/data}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:5173,http://localhost:$PORT}"
OLLAMA_URL="${LLM_BASE_URL:-http://127.0.0.1:11434}"
OS="$(uname -s)"
STARTED_OLLAMA_PID=""

info() { printf '>> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

confirm() {
  $ASSUME_YES && return 0
  [ -t 0 ] || return 1
  read -r -p ">> $1 [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]]
}

# install_tool <name> <macOS brew package> <Linux instructions>
install_tool() {
  local name="$1" brew_package="$2" linux_hint="$3"
  $INSTALL || die "$name is not installed. $linux_hint"
  if [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    confirm "$name is not installed. Install it with 'brew install $brew_package'?" \
      || die "$name is required."
    brew install "$brew_package"
  elif [ "$OS" = "Linux" ] && [ "$name" = "ollama" ]; then
    confirm "Ollama is not installed. Install it with the official script (https://ollama.com/install.sh)?" \
      || die "Ollama is required."
    curl -fsSL https://ollama.com/install.sh | sh
  else
    die "$name is not installed. $linux_hint"
  fi
}

cleanup() {
  if [ -n "$STARTED_OLLAMA_PID" ]; then
    info "Stopping the Ollama server started by this script"
    kill "$STARTED_OLLAMA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- Node.js 20+ ---
if ! command -v node >/dev/null 2>&1; then
  install_tool node node "Install Node.js 20 or newer: https://nodejs.org"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20 or newer is required (found $(node -v))."

# --- Port ---
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT is already in use (is the Docker container running? ./RUN.sh --stop). Or set PORT=..."
fi

# --- Ollama ---
if [ "$LLM_PROVIDER" = "ollama" ]; then
  if ! curl -sf "$OLLAMA_URL/api/version" >/dev/null 2>&1; then
    case "$OLLAMA_URL" in
      http://127.0.0.1:*|http://localhost:*) ;;
      *) die "cannot reach Ollama at $OLLAMA_URL (LLM_BASE_URL)." ;;
    esac
    command -v ollama >/dev/null 2>&1 \
      || install_tool ollama ollama "Install Ollama: https://ollama.com/download"
    mkdir -p "$DATA_DIR"
    info "Starting Ollama (logs: $DATA_DIR/ollama.log)"
    OLLAMA_HOST="${OLLAMA_URL#http://}" ollama serve >"$DATA_DIR/ollama.log" 2>&1 &
    STARTED_OLLAMA_PID=$!
    for _ in $(seq 1 30); do
      curl -sf "$OLLAMA_URL/api/version" >/dev/null 2>&1 && break
      sleep 1
    done
    curl -sf "$OLLAMA_URL/api/version" >/dev/null 2>&1 \
      || die "Ollama did not start, see $DATA_DIR/ollama.log"
  fi
  info "Ollama $(curl -s "$OLLAMA_URL/api/version" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p') at $OLLAMA_URL"

  if ! OLLAMA_HOST="${OLLAMA_URL#http://}" ollama show "$LLM_MODEL" >/dev/null 2>&1; then
    info "Downloading model $LLM_MODEL (first run only)"
    OLLAMA_HOST="${OLLAMA_URL#http://}" ollama pull "$LLM_MODEL"
  fi
  # Load the model now so the first answer is fast.
  curl -s "$OLLAMA_URL/api/generate" -d "{\"model\":\"$LLM_MODEL\",\"keep_alive\":\"30m\"}" >/dev/null &
fi

# --- Context and data ---
mkdir -p "$(dirname "$CONTEXT_FILE")" "$DATA_DIR"
if [ ! -f "$CONTEXT_FILE" ]; then
  echo "Write the AI context here (business information, tone, policies...)." >"$CONTEXT_FILE"
  info "Created $CONTEXT_FILE, edit it with your information"
fi

# --- Dependencies and build ---
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  info "Installing npm dependencies"
  npm ci
  touch node_modules
fi

info "API at http://localhost:$PORT and ws://localhost:$PORT/ws (provider=$LLM_PROVIDER model=$LLM_MODEL)"
info "Context: $CONTEXT_FILE | Data: $DATA_DIR | Ctrl+C to stop"
if $DEV; then
  npx tsx watch src/server.ts
else
  npm run build >/dev/null
  node dist/server.js
fi
