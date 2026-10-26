# Docker

Build and run **our own** 9Router image from this repo. This is a private fork: we do **not** use the upstream `decolua/9router` image and there is no CI publish step. Everything is built locally from `xp/main`.

Runs as a Linux container on the WSL2 side of Docker Desktop (`linux/amd64`).

---

## Deploy (canonical)

```bash
./start.sh
```

`start.sh`:

1. builds `9router:local` from this repo,
2. smoke-tests it on `127.0.0.1:20129` with a throwaway container,
3. stops the running `9router` and renames it to `9router-rollback-<timestamp>`,
4. starts the new container on `127.0.0.1:20128`,
5. waits for `/api/health` to return `200`.

Data lives in the `9router-data` volume and survives every deploy. Secrets come from `.env` (git-ignored) — they are never baked into the image.

## Compose alternative

```bash
docker compose up -d --build
```

`docker-compose.yml` builds from this repo into `9router:local`, reuses the `9router-data` volume, binds `127.0.0.1:20128`, and reads `.env`.

## Manage container

```bash
docker logs -f 9router
docker compose stop
docker compose start
docker compose down        # removes the container, keeps the 9router-data volume
```

## Rollback

```bash
docker stop 9router && docker rm 9router
docker rename 9router-rollback-<timestamp> 9router
docker start 9router
```

## Configuration (`.env`)

`.env` in the repo root is required (git-ignored). It is derived from the running container's env. Minimum keys:

```text
JWT_SECRET=...            # session cookie
INITIAL_PASSWORD=...      # dashboard login
API_KEY_SECRET=...        # endpoint API keys
MACHINE_ID_SALT=...       # machine identity — must stay stable
DATA_DIR=/app/data
```

`MACHINE_ID_SALT` must not change between deploys, or instance identity/keys rotate.

## Data layout

`DATA_DIR=/app/data` → volume `9router-data`:

```text
/app/data/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

## Headroom (optional)

Not enabled in the current deployment. If needed, run Headroom as a sidecar and set `HEADROOM_URL=http://headroom:8787` on the `9router` service.

## Build registry

The Dockerfile defaults to the public npm registry, which is **blocked on this network**. `start.sh` and `docker-compose.yml` default `NPM_REGISTRY` to the internal feed `https://packagefeedproxy.microsoft.io/npm/` (see `~/.npmrc`). Override per build when needed:

```bash
NPM_REGISTRY=https://registry.npmmirror.com/ ./start.sh

docker build --build-arg NPM_REGISTRY="$NPM_REGISTRY" -t 9router:local .
```

Alpine packages and the base image come from their public mirrors and resolve fine here.
