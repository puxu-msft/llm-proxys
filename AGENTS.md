# AGENTS.md

This file provides guidance to coding agents working in this repository. Subdirectories that need different rules carry their own `AGENTS.md` (`open-sse/AGENTS.md`, `tests/translator/AGENTS.md`).

## Repo & branch policy — READ FIRST

This checkout is a **personal, private fork**. Changes here are for personal use and are **not** meant to be contributed back upstream.

- Develop on **`xp/main`** — the long-lived personal branch. `master` only mirrors upstream; don't put personal work there.
- `origin` = `puxu-msft/9router` (private) — the **only push target**; push `xp/main` here.
- `up` = `decolua/9router` — **read-only upstream, reference only**. Never push to `up`, never open PRs against it. Pull updates with `git fetch up && git merge up/master`.
- Divergence from upstream is expected and fine — don't "align" local behavior back to upstream unless asked.
- Private, non-open-source repo: skip upstream-collaboration overhead — no license/SPDX header compliance, no contributor/PR-review ceremony, no release-changelog duties. Keep versioning and commits practical (see the bottom of this file).

## What this is

9Router (`9router-app`) — a local AI routing gateway + Next.js dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, quota/usage tracking, and optional cloud sync.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

The code lives in `src/` (Next.js app + dashboard/compat APIs), `open-sse/` (the provider-agnostic routing/translation engine), `cli/` (the launcher package), and `tests/`.

## Commands

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev   # dev (webpack, port 20127 by default via next dev)
npm run build && PORT=20128 HOSTNAME=0.0.0.0 npm run start           # production
```
- Bun variants: `npm run dev:bun` / `build:bun` / `start:bun`.
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint 为**手动可选、默认不启用**（配置 `eslint.config.mjs`）：无 CI、无 git hook、无 `lint` 脚本，Next 16 构建时也不 lint，所以永不阻塞。需要时手动跑 `npx eslint .`；强制关口是 vitest。

CLI package (`cli/`):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

Docker (our own build — this fork does **not** use the upstream `decolua/9router` image):
```bash
./start.sh                      # build 9router:local → smoke-test → swap in place, keeping a rollback container
docker compose up -d --build    # equivalent via compose
```
> Built from this repo and deployed locally against the WSL2 Docker Desktop engine — no registry, no CI publish. The running `9router` container **must** be our build, not the upstream image. Data persists in the `9router-data` volume; secrets come from `.env` (git-ignored, carries `JWT_SECRET`/`INITIAL_PASSWORD`/`API_KEY_SECRET`/`MACHINE_ID_SALT` — keep `MACHINE_ID_SALT` stable). Details in `DOCKER.md`.
> The public npm registry is **blocked on this network**: npm deps must come from the internal feed. `start.sh`/`docker-compose.yml` default `NPM_REGISTRY` to `https://packagefeedproxy.microsoft.io/npm/` (from `~/.npmrc`); pass `NPM_REGISTRY=…` to override.

Tests (vitest, in `tests/`, an **independent** ESM package — not wired into root `npm test`):
```bash
npm install                             # ROOT deps first — tests import from src/ which needs `open`, `undici`, etc.
cd tests && npm install                 # then tests' own deps (vitest) → tests/node_modules (allowed by tests/.gitignore)
npx vitest run                          # all tests; auto-discovers tests/vitest.config.js
npx vitest run unit/capabilities.test.js   # single file (path relative to tests/)
```
> The committed `tests/package.json` `test` script hardcodes Unix paths (`NODE_PATH=/tmp/node_modules …`) — a shared-install workaround from upstream. On Windows (or anywhere), ignore it and use the `npx vitest` form above; `vitest.config.js` resolves the `open-sse`/`@/` aliases from the repo root regardless of where vitest lives.
>
> **The suite is NOT expected to be all-green on a plain checkout.** ~938 pass, ~64 fail. Judge regressions with `tests/__baseline__/verify-no-regression.mjs`, not a raw run. Expected red:
> - 26 catalogued in `tests/__baseline__/known-fails.txt` (rtk, oauth-cursor-auto-import, translator-request-normalization, …).
> - `unit/embeddings.cloud.test.js` imports `cloud/src/handlers/embeddings.js` — the `cloud/` worker dir is **not in this repo**, so it always fails here.
> - `unit/xai-oauth-service.test.js` times out (5s) when the xAI endpoint-discovery fetch isn't reachable/mocked.
> - `real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
- `*.real.test.js` under `tests/translator/real/` make live provider calls — skip unless credentials are set.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `docs/ARCHITECTURE.md` — full system: request lifecycle, combo/account fallback, OAuth + token refresh, cloud sync, data model.
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`src/app/api/v1/*` route (Next rewrite maps `/v1/*` → `/api/v1/*` in `next.config.mjs`)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.

### Translator engine (`open-sse/translator/`)
- Pivots through **OpenAI as the intermediate format**. A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a **direct route**, skipping the lossy double-hop. Prefer a direct route for fragile pairs (thinking blocks, tool ids, non-base64 images, `is_error`).
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an import side effect — a new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `open-sse/translator/schema/` and `open-sse/config/` constants. Config-driven and DRY is enforced by convention here.

### Credentials that live in another service (`wam`)
- A connection whose `authType` is `wam` stores no secret of its own: it names a wam-proxy instance's OAuth 2.0 client-credentials endpoint, and the bearer token is fetched per request. `open-sse/shared/wamToken.js` does the fetching (its own TTL cache, one in-flight acquisition shared by concurrent callers, nothing cached on failure), and `BaseExecutor.resolveExternalCredentials()` writes the result onto the credentials object before the synchronous `buildHeaders` reads it. The shared refresh machinery is deliberately not involved — it requires a `refreshToken`, and `wam` has none.
- Its providerSpecificData fields are flat and `wam`-prefixed (see `open-sse/config/wamConstants.js`). `wamClientSecret` / `wamClientCertPassword` are stripped from every provider API response, and the edit path reads a blank secret field as "keep the stored one".
- `loki` (`lk/`) is the first user: a first-party, internally-hosted model service reachable only with such a token. One endpoint per wire format, routed by model name — the same shape as `github`, and for the same reason (no per-model `targetFormat`). Its private connection values live in `open-sse/config/lokiConstants.js`.

### Model catalogues (`modelSource`)
- Two different things, often confused. **`modelsFetcher`** is the dashboard's model picker: a URL its route fetches **without credentials** and filters down to what that picker should offer. **`modelSource`** is a *reference* for the static `models[]`: where to read the provider's real catalogue, how to authenticate, how to normalize it. It is read by `node scripts/model-source.mjs <provider>`, which prints what the upstream offers and how it differs from the declared list, so that list is updated deliberately instead of drifting or being replaced at request time.
- The static list stays authoritative — nothing resolves a `modelSource` on the request path, and a failure to read one never affects serving.
- Normalizers live in `open-sse/services/modelCatalogFilters.js`, keyed by the `format` a declaration names; do not fetch a catalogue anywhere else.
- Those two modules must keep **relative imports**: `scripts/*.mjs` run under a plain `node`, where the `@/` and `open-sse/` path aliases do not resolve.

### Provider registry (`open-sse/providers/registry/*`)
- One file per provider. `providers/registry/index.js` is an **auto-generated** static import list — regenerate it with `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`, don't hand-edit.
- Add a provider: copy `providers/REGISTRY_TEMPLATE.js`, add models to `config/providerModels.js`. Only add an executor for non-OpenAI-compatible upstreams.
- Adding a provider or alias changes `tests/__baseline__/providers-baseline.json` and `alias-baseline.json`; re-snapshot them deliberately with `snapshot-providers.mjs` and `verify-alias.mjs --snapshot`, and add any new alias token to the `ALIAS_TOKENS` list so later regressions are actually caught.

### Persistence — IMPORTANT (ARCHITECTURE.md is stale here)
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` is deliberately in `optionalDependencies` so install never fails without build tools.
- `src/lib/localDb.js` is a **backward-compat shim** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`).
- Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)
Pre-translate hooks that compress `tool_result` content in-place to cut tokens. **Fail-open**: any error returns null and leaves the body untouched — never throw out of them. Skips `is_error`/`status:"error"` results to preserve traces.

## Conventions & gotchas

- **Never hard-wrap lines.** `.editorconfig` sets `max_line_length = off`: keep a sentence, paragraph, or list item on one line and let the editor soft-wrap it. Don't break at a fixed 80/120 column; if a line must be split, split at a semantic boundary (a comma, a period).
- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- `custom-server.js` wraps the Next standalone server to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` — trusting forwarding headers only from a loopback reverse proxy. Preserve this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` and ARCHITECTURE.md's env matrix.
- Binary/protobuf upstreams (kiro EventStream, cursor protobuf, commandcode NDJSON) don't round-trip through OpenAI — they're handled inside their own executor, not the translator.
- Security: keep code safe by default — avoid obvious vulns (command injection, SSRF, credential/token leaks, blindly trusting `X-Forwarded-For`). This is a private fork, so there is no upstream PR security-review process to run.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
