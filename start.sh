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

NETWORK=9router-net
HEADROOM_NAME=headroom
HEADROOM_IMAGE=ghcr.io/chopratejas/headroom:latest
HEADROOM_PORT=8787
HEADROOM_URL="http://${HEADROOM_NAME}:${HEADROOM_PORT}"

cd "$(dirname "$0")"

if [ ! -f "$ENV_FILE" ]; then
  echo "missing $ENV_FILE (copy .env.example and fill in secrets)" >&2
  exit 1
fi

echo "==> ensure network $NETWORK"
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

echo "==> ensure headroom sidecar on 127.0.0.1:$HEADROOM_PORT"
if docker inspect "$HEADROOM_NAME" >/dev/null 2>&1; then
  docker network connect "$NETWORK" "$HEADROOM_NAME" >/dev/null 2>&1 || true
  docker start "$HEADROOM_NAME" >/dev/null 2>&1 || true
else
  docker run -d --name "$HEADROOM_NAME" --restart always \
    --network "$NETWORK" \
    -p "127.0.0.1:$HEADROOM_PORT:$HEADROOM_PORT" \
    "$HEADROOM_IMAGE" >/dev/null
fi

echo "==> build $IMAGE (npm registry: $NPM_REGISTRY)"
docker build --build-arg "NPM_REGISTRY=$NPM_REGISTRY" -t "$IMAGE" .

echo "==> smoke test on 127.0.0.1:$SMOKE_PORT"
docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true
docker run -d --name "$SMOKE_NAME" \
  --network "$NETWORK" \
  -p "127.0.0.1:$SMOKE_PORT:$PORT" \
  --env-file "$ENV_FILE" \
  -e DATA_DIR=/app/data \
  -e HEADROOM_URL="$HEADROOM_URL" \
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
  # A renamed container keeps its restart policy: on a Docker/host restart it
  # would come back up and steal the published port from the new container.
  docker update --restart no "$ROLLBACK" >/dev/null
fi

echo "==> starting $NAME"
docker run -d --name "$NAME" --restart always \
  --network "$NETWORK" \
  -p "$PORT:$PORT" \
  --env-file "$ENV_FILE" \
  -v "$VOLUME:/app/data" \
  -e DATA_DIR=/app/data \
  -e HEADROOM_URL="$HEADROOM_URL" \
  "$IMAGE"

i=0
while [ "$i" -lt 30 ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)
  [ "$code" = "200" ] && break
  i=$((i + 1))
  sleep 2
done

if [ "$code" != "200" ]; then
  echo "==> deployed but health check returned ${code:-none}; check: docker logs $NAME" >&2
  exit 1
fi

echo "==> headroom reachable from $NAME?"
docker exec "$NAME" node -e "fetch('$HEADROOM_URL/').then(r=>console.log('   ok, status',r.status)).catch(e=>console.log('   NOT reachable:',e.message))" 2>/dev/null || echo "   could not probe"

echo "==> deployed: http://127.0.0.1:$PORT (bound 0.0.0.0, health 200)"
