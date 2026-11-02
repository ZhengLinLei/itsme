#!/usr/bin/env bash
# Build the Docker image.
#   ./BUILD.sh                     -> full image (Node + Ollama), model downloads at startup
#   ./BUILD.sh --preload           -> include LLM_MODEL in the image (offline)
#   ./BUILD.sh --slim              -> Node only (for OpenAI / Anthropic / remote Ollama)
#   ./BUILD.sh -t my-tag           -> custom tag
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

IMAGE_NAME="${IMAGE_NAME:-itsme-api}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
LLM_MODEL="${LLM_MODEL:-qwen2.5:3b}"
TARGET=full
PRELOAD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --slim) TARGET=slim ;;
    --preload) PRELOAD="$LLM_MODEL" ;;
    -t|--tag) IMAGE_TAG="$2"; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

echo ">> Building $IMAGE_NAME:$IMAGE_TAG (target=$TARGET${PRELOAD:+, model=$PRELOAD})"
docker build \
  -f docker/Dockerfile \
  --target "$TARGET" \
  --build-arg PRELOAD_MODEL="$PRELOAD" \
  -t "$IMAGE_NAME:$IMAGE_TAG" \
  .
echo ">> Ready: $IMAGE_NAME:$IMAGE_TAG"
