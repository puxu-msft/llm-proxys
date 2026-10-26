#!/bin/sh
set -eu

IMAGE=9router:local
NAME=9router
VOLUME=9router-data
ENV_FILE=.env
PORT=20128
SMOKE_PORT=20129
SMOKE_NAME="${NAME}-smoke"
NPM_REGISTRY="${NPM_REGISTRY:-https://packagefeedproxy.microsoft.io/npm/}"

cd "$(dirname "$0")"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE (copy .env.example and fill in secrets)" >&2
  exit 1
fi

echo "==> build $IMAGE (npm registry: $NPM_REGISTRY)"
docker build --build-arg "NPM_REGISTRY=$NPM_REGISTRY" -t "$IMAGE" .

echo "==> smoke test on 127.0.0.1:$SMOKE_PORT"
docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true
docker run -d --name "$SMOKE_NAME" \
  -p "127.0.0.1:$SMOKE_PORT:$PORT" \
  --env-file "$ENV_FILE" \
  -e DATA_DIR=/app/data \
  "$IMAGE" >/dev/null

code=""
i=0
while [ "$i" -lt 30 ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/api/health" || true)
  [ "$code" = "200" ] && break
  i=$((i + 1))
  sleep 2
done
docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true

if [ "$code" != "200" ]; then
  echo "smoke test failed (last status: ${code:-none}); aborting, running container untouched" >&2
  exit 1
fi

if docker inspect "$NAME" >/dev/null 2>&1; then
  ROLLBACK="${NAME}-rollback-$(date +%Y%m%d-%H%M%S)"
  echo "==> stopping $NAME -> kept as $ROLLBACK"
  docker stop "$NAME" >/dev/null
  docker rename "$NAME" "$ROLLBACK"
fi

echo "==> starting $NAME"
docker run -d --name "$NAME" --restart always \
  -p "127.0.0.1:$PORT:$PORT" \
  --env-file "$ENV_FILE" \
  -v "$VOLUME:/app/data" \
  -e DATA_DIR=/app/data \
  "$IMAGE"

i=0
while [ "$i" -lt 30 ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)
  [ "$code" = "200" ] && break
  i=$((i + 1))
  sleep 2
done

if [ "$code" = "200" ]; then
  echo "==> deployed: http://127.0.0.1:$PORT (health 200)"
else
  echo "==> deployed but health check returned ${code:-none}; check: docker logs $NAME" >&2
  exit 1
fi
