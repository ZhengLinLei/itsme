#!/usr/bin/env bash
# Start the container.
#   ./RUN.sh          -> detached (logs: docker logs -f itsme-api)
#   ./RUN.sh -f       -> foreground
#   ./RUN.sh --gpu    -> use an NVIDIA GPU (Linux with nvidia-container-toolkit)
#   ./RUN.sh --stop   -> stop and remove the container
# ./context/context.txt is mounted into the container and reloaded automatically.
# Sessions are kept in the <container>-data volume, models in <container>-models.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

IMAGE_NAME="${IMAGE_NAME:-itsme-api}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-itsme-api}"
HOST_PORT="${HOST_PORT:-3000}"
PORT="${PORT:-3000}"
MODE=(-d --restart unless-stopped)
EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    -f|--foreground) MODE=(--rm -it) ;;
    --gpu) EXTRA+=(--gpus all) ;;
    --stop) docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 && echo ">> Stopped $CONTAINER_NAME"; exit 0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

mkdir -p context
[ -f context/context.txt ] || echo "Write the AI context here." > context/context.txt

ENV_FILE=()
[ -f .env ] && ENV_FILE=(--env-file .env)

# Remove the previous container, retrying until Docker releases the name (it can be slow).
for _ in $(seq 1 30); do
  docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1 || break
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  sleep 1
done
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Could not remove the old $CONTAINER_NAME container. Try: docker rm -f $CONTAINER_NAME" >&2
  exit 1
fi
docker run "${MODE[@]}" "${EXTRA[@]+"${EXTRA[@]}"}" \
  --name "$CONTAINER_NAME" \
  "${ENV_FILE[@]+"${ENV_FILE[@]}"}" \
  -e PORT="$PORT" \
  -p "$HOST_PORT:$PORT" \
  --add-host host.docker.internal:host-gateway \
  -v "$(pwd)/context:/app/context:ro" \
  -v "${CONTAINER_NAME}-models:/root/.ollama" \
  -v "${CONTAINER_NAME}-data:/app/data" \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --pids-limit 512 \
  "$IMAGE_NAME:$IMAGE_TAG"

[ "${MODE[0]}" = "-d" ] && echo ">> $CONTAINER_NAME at http://localhost:$HOST_PORT  (logs: docker logs -f $CONTAINER_NAME)"
