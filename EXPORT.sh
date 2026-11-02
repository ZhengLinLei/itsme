#!/usr/bin/env bash
# Export the image.
#   ./EXPORT.sh hub user/itsme-api[:tag]      -> push to Docker Hub (run docker login first)
#   ./EXPORT.sh tar [file.tar.gz]             -> save to dist/<image>-<tag>.tar.gz
# To load a tar.gz on another machine: gunzip -c file.tar.gz | docker load
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

IMAGE="${IMAGE_NAME:-itsme-api}:${IMAGE_TAG:-latest}"
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "Image $IMAGE does not exist. Run ./BUILD.sh first." >&2; exit 1; }

case "${1:-}" in
  hub)
    REMOTE="${2:-${DOCKERHUB_REPO:-}}"
    [ -n "$REMOTE" ] || { echo "Usage: $0 hub user/repository[:tag]" >&2; exit 1; }
    [[ "$REMOTE" == *:* ]] || REMOTE="$REMOTE:${IMAGE_TAG:-latest}"
    docker tag "$IMAGE" "$REMOTE"
    docker push "$REMOTE"
    echo ">> Pushed: $REMOTE"
    ;;
  tar)
    OUT="${2:-build/$(echo "$IMAGE" | tr '/:' '__').tar.gz}"
    mkdir -p "$(dirname "$OUT")"
    echo ">> Saving $IMAGE to $OUT ..."
    docker save "$IMAGE" | gzip > "$OUT"
    echo ">> Ready: $OUT ($(du -h "$OUT" | cut -f1))"
    ;;
  *)
    sed -n '2,5p' "$0"; exit 1 ;;
esac
