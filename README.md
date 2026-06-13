# paas2box

A NetBox-compatible REST API for the **DCIM**, **IPAM**, and **Virtualization**
sections — same OpenAPI contract as the [NetBox community
project](https://github.com/netbox-community/netbox), **without an ORM**, running
over **SQLite** (small deployments) or **MariaDB** (large deployments).

The whole stack is generated from one source of truth: the NetBox OpenAPI schema →
a database data model → SQL DDL for both engines → TypeScript types + a generic
repository → an HTTP API that serializes NetBox-shaped responses.

## Layout

| Path | What |
|------|------|
| [`openapi/`](openapi/) | Filtered NetBox OpenAPI spec (DCIM/IPAM/Virtualization) + extractor |
| [`datamodel/`](datamodel/) | Data model + generators → `data-model.json`, dual-dialect SQL, coverage report |
| [`migrations/`](migrations/) | Plain-SQL migrations (per dialect) + a no-ORM runner |
| [`src/`](src/) | TypeScript data layer + HTTP API (db abstraction, repository, serializer, auth, WebSocket feed) |
| [`web/`](web/) | Vue 3 + Vite + TS + Pinia admin UI — schema-driven, live over WebSocket |
| [`scripts/`](scripts/) | `generate.mjs` — emits TS types + runtime metadata from the data model |
| [`test/`](test/) | `node:test` suites incl. an OpenAPI contract test (ajv) |

## Quick start

```bash
npm install
npm run build                              # tsc -> dist/

# SQLite
python3 migrations/migrate.py --dialect sqlite --database ./paas2box.db
PB_DIALECT=sqlite PB_SQLITE_FILE=./paas2box.db PORT=8000 npm start

# MariaDB
python3 migrations/migrate.py --dialect mariadb --database paas2box \
  --host 127.0.0.1 --user paas2box --password secret
PB_DIALECT=mariadb DB_NAME=paas2box DB_USER=paas2box DB_PASSWORD=secret npm start
```

Then e.g. `curl localhost:8000/api/dcim/manufacturers/`. The live OpenAPI schema is
at `GET /api/schema/` (Swagger UI at `/api/schema/swagger-ui/`), generated from the
registry so it always reflects core **and** any loaded plugins.

### Docker

```bash
docker build -t paas2box .
# SQLite, auto-migrated on startup (data persisted in a volume):
docker run -p 8000:8000 -e PB_MIGRATE=1 -v paas2box-data:/data paas2box
```

The image is multi-stage and runs as a non-root user. It bundles the built Vue UI
and serves **everything on one port**: the SPA at `/`, the REST API at `/api/`,
the OpenAPI schema at `/api/schema/`, and the WebSocket change-feed at `/api/ws/`.
`PB_MIGRATE=1` applies the bundled SQLite migrations on boot (via
`scripts/migrate-sqlite.mjs`, no Python in the image); for MariaDB, run migrations
separately.

**Auth is secure by default.** `PB_AUTH_REQUIRED` defaults to `1`: anonymous requests
are rejected (`403`), and the WebSocket change-feed at `/api/ws/` likewise requires a
valid token. So **bootstrap a credential before use** — either enable OIDC (see
[docs/SSO-API-ACCESS.md](docs/SSO-API-ACCESS.md)), or pre-seed an API token with
`PB_SEED_TOKEN` (idempotent on boot, owned by `PB_SEED_USERNAME`, default `admin`):

```bash
docker run -p 8000:8000 -e PB_MIGRATE=1 -v paas2box-data:/data \
  -e PB_SEED_TOKEN="$(openssl rand -hex 20)" paas2box
# then call the API with:  Authorization: Token <that value>
```

Outside Docker / for SQLite you can also run `node scripts/seed-token.mjs <db-file>`
(prints a generated key). For **local dev only**, `-e PB_AUTH_REQUIRED=0` allows anonymous access.

### Run the web UI

The admin UI (Vue 3, NetBox-style, schema-driven, live over WebSocket) can be run
two ways.

**Single container (simplest — UI + API + schema + WebSocket on one port):**

```bash
docker build -t paas2box .
docker run --rm -p 8000:8000 -e PB_MIGRATE=1 paas2box
# then open http://localhost:8000/
```

**Dev mode (hot reload, for working on the UI) — two processes:**

```bash
# Terminal 1 — backend (API + WebSocket on :8000)
npm install && npm run build
node scripts/migrate-sqlite.mjs ./paas2box.db          # create the SQLite schema (no Python)
PB_SQLITE_FILE=./paas2box.db node dist/main.js

# Terminal 2 — Vue dev server (proxies /api and /api/ws to :8000)
cd web && npm install && npm run dev                  # then open http://localhost:5173
```

A fresh database is empty — click **+ Add** in the UI, or seed via the API. Full
details in [`web/README.md`](web/README.md).

### Development

```bash
npm run ci              # run the whole pipeline locally (mirrors GitHub Actions)
npm run lint            # ESLint (TS/JS)
npm run format          # Prettier write  (format:check in CI)
npm test                # build + SQLite test suite
ruff check . && ruff format --check .   # Python scripts
```

## Local CI

[`scripts/ci.sh`](scripts/ci.sh) (aliased as `npm run ci`) runs the **same five
stages** as the GitHub Actions pipeline, so you can validate everything before you
push — no GitHub round-trip needed.

```bash
npm run ci                     # run the whole pipeline
scripts/ci.sh lint test        # run only specific stages
SKIP_DOCKER=1 npm run ci       # skip the Docker / MariaDB stages
```

### Stages

| Stage | What it runs | Requires |
|-------|--------------|----------|
| `lint` | Prettier `--check`, ESLint, Ruff (`format --check` + `check`) | Node; Ruff optional |
| `test` | `npm test` — `tsc` build + the SQLite `node:test` suite | Node |
| `security` | `npm audit --audit-level=high`, Trivy CVE scan | Node; Trivy optional |
| `build` | `tsc`, then `docker build` + container smoke test (boot → migrate → POST/GET) | Node; Docker optional |
| `test-mariadb` | ephemeral `mariadb:11` container, applies migrations, runs the MariaDB suite | Docker |

### Behaviour

- **Graceful skips.** A stage whose tool isn't installed (Docker, Ruff, Trivy) is
  reported as `SKIP` with an install hint instead of failing — so the script runs
  on any machine. Force-skip the container stages with `SKIP_DOCKER=1`.
- **Subset runs.** Pass stage names as arguments: `scripts/ci.sh lint`,
  `scripts/ci.sh test test-mariadb`, etc. With no arguments it runs all five.
- **Self-contained MariaDB.** Migrations are applied by piping the `.mariadb.sql`
  files into the container's own client (`docker exec`), so no host MariaDB client
  or Python driver is needed. The ephemeral containers are removed on exit (even on
  failure) via a cleanup trap.
- **Honest result.** Each stage prints `✓` / `✗` / `SKIP`; the run ends with a
  `passed / skipped / failed` summary and exits non-zero **only** on a real failure
  (skips never fail the run).
- **Dependencies.** Installs npm deps with `npm ci` only if `node_modules` is
  missing; otherwise it uses what's already there.

Example output:

```text
== summary ==
passed:  prettier eslint ruff-format ruff-check test (sqlite) npm-audit build (tsc) docker-image test (mariadb)
skipped: trivy
CI PASSED
```

### GitHub Actions

The same stages run in CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) as
five jobs: **test** (SQLite), **test-mariadb** (service container), **lint**
(ESLint + Prettier + Ruff), **security** (`npm audit` + Trivy CVE scan), and
**build** (uploads the `dist/` artifact and builds + smoke-tests the Docker image).

## Features

- **82 entities → 94 tables** (DCIM/IPAM/Virtualization + the external entities they
  reference), dual-dialect SQL generated from `data-model.json`.
- **No ORM**: a single metadata-driven generic `Repository` with parameterized SQL.
- NetBox-shaped responses: pagination envelope, `url`/`display`/`display_url`, FK
  **nested briefs** (batched, O(1) in row count), choice `{value,label}`, tags & M2M,
  generic relations (`scope`/`assigned_object`), and computed fields (`family`,
  `children`/`_depth`, reverse-FK `*_count`).
- Query lookups (`__ic`, `__in`, `__gte`, `q`, `ordering`), pre-write validation
  (NetBox field-error shape), and optional token auth (`Authorization: Token …`).
- **SSO via OIDC — multiple providers** ([src/oidc.ts](src/oidc.ts)): sign in via several
  OIDC providers at once (e.g. **Keycloak _and_ Google**), chosen on the login page.
  Because providers differ in ways OIDC leaves open (JWT vs opaque access tokens, public
  vs confidential clients, roles vs no roles), the SPA only does the PKCE redirect; the
  **code→token exchange runs server-side** (a Backend-for-Frontend, `POST
  /api/auth/oidc/exchange/`). The backend holds any client secret, verifies the **id_token**
  against the issuer's JWKS, normalizes authorization, auto-provisions the user, and mints
  a **paas2box token** the SPA uses for all API/WS calls — so the browser never holds a
  provider secret or token. Authorization is per provider: **Keycloak** → a realm/client
  **role** grants write; **Google** → a **domain allowlist** gates login and an **email
  allowlist** grants write. Configure with `PB_OIDC_PROVIDERS=keycloak,google` and
  per-provider `PB_OIDC_<ID>_*` vars (issuer, client id/secret, write role, allowed
  domains/emails); a legacy single `PB_OIDC_*` provider is still honored. Service-account
  **`Authorization: Bearer <JWT>`** (Keycloak) still works directly for automation. The
  web UI ([web/src/auth/oidc.ts](web/src/auth/oidc.ts)) renders a button per provider and
  signs out by revoking the token. For **headless API access**, see
  [docs/SSO-API-ACCESS.md](docs/SSO-API-ACCESS.md).
- **OpenAPI conformance** enforced by `test/contract.test.mjs` (validates live
  responses against the NetBox read schemas with `ajv`).
- **Plugins** ([src/plugins/](src/plugins/)): third parties extend paas2box by
  registering entity metadata (+ DDL) — the engine then exposes a full NetBox-shaped
  CRUD API under `/api/plugins/<name>/…` automatically — plus custom routes and write
  hooks. Load via `PB_PLUGINS=<module,…>` or the `paas2box.plugins` key in
  `package.json` (loaded on startup, no config needed). See **Docker** below for a
  built-in example.
- **Webhooks** ([src/webhooks.ts](src/webhooks.ts)): configurable HTTP webhooks fired
  on object **create/update/delete**, managed as a normal CRUD resource at
  `/api/extras/webhooks/` — object-type + event filtering, **conditions** (fire only
  when fields match, NetBox event-rule style: `{and/or}`, `{attr,op,value}`, or a
  plain `{field: value}` map), optional **HMAC-SHA512** signature, custom headers,
  TLS-verify toggle, **retry with exponential backoff**, and an auditable read-only
  **delivery log** at `/api/extras/webhook-deliveries/`. Works for **core and plugin**
  entities alike.
  - **Jinja-style templating** (NetBox-compatible): `payload_url`, each
    `additional_headers` value, and an optional `body_template` are rendered with the
    event context — `{{ event }}`, `{{ model }}`, `{{ timestamp }}`, `{{ username }}`,
    `{{ request_id }}`, `{{ data.* }}` (full serialized object, incl. nested relations),
    and `{{ snapshots.prechange.* }}` / `{{ snapshots.postchange.* }}`; filters
    `default`/`urlencode`/`lower`/`upper`. E.g. a per-object URL
    `https://host/devices/{{ data.name }}/sync`.
  - **Credentials**: a token in the URL query string, an `Authorization`/API-key header
    via `additional_headers`, or `http://user:pass@host` (auto-converted to a Basic
    auth header; the password is redacted in the delivery log).
  - The change feed is also available live over a **WebSocket** at `/api/ws/`.
- **Migrate from NetBox** ([src/plugins/netbox-migrate/](src/plugins/netbox-migrate/)): a
  built-in plugin that imports a live NetBox instance into paas2box over the REST API —
  FK-dependency ordering, id remapping, and a live progress counter. Run it from the web
  UI (**NetBox Migrate** in the sidebar) or `POST /api/plugins/netbox-migrate/run/`. See
  **Migrate from NetBox** below.

## Docker management (built-in plugin)

A built-in plugin ([src/plugins/docker/](src/plugins/docker/)) manages Docker — a port
of [SaaShup/netbox-docker-plugin](https://github.com/SaaShup/netbox-docker-plugin),
designed to pair with the
[netbox-docker-agent](https://github.com/SaaShup/netbox-docker-agent). It is **loaded by
default** (via the `paas2box.plugins` key in `package.json`), so the endpoints are live
out of the box and appear in the web UI under the **plugins** menu section.

| Endpoint | Notes |
|----------|-------|
| `/api/plugins/docker/hosts/` | embeds `images`/`volumes`/`networks`/`containers`/`registries`; a `dockerhub` registry is auto-created on host creation |
| `/api/plugins/docker/registries/` | embeds `images` |
| `/api/plugins/docker/images/` | embeds `containers`; `POST {id}/force_pull/` proxies to the agent |
| `/api/plugins/docker/volumes/` | embeds `mounts` |
| `/api/plugins/docker/networks/` | embeds `network_settings` |
| `/api/plugins/docker/containers/` | inline nested `ports`/`env`/`labels`/`mounts`/`binds`/`network_settings`/`devices`/`log_driver_options`/`sysctls` on **read and write**; cross-host integrity is validated; `GET {id}/logs/`, `POST {id}/exec/` proxy to the agent |

Differences from the NetBox plugin (documented gaps): NetBox token + webhook
auto-provisioning is dropped (paas2box has its own auth + a WebSocket change-feed); the
agent-driven container state machine is not enforced (`state`/`operation` are plain
fields); `logs` is returned JSON-encoded (plugin responses are JSON-only). The nested
container routes build absolute `url`s from `BASE_URL` (set it for parity with core
endpoints). Tests: [test/docker.test.mjs](test/docker.test.mjs).

## Migrate from NetBox (built-in plugin)

A built-in plugin ([src/plugins/netbox-migrate/](src/plugins/netbox-migrate/)) performs a
one-shot import of a **live NetBox** instance into paas2box over the REST API. Because
paas2box mirrors the NetBox API, each entity is read from the *same* endpoint on NetBox
and written locally — so the engine only has to handle the two hard parts:

- **Dependency order** — entities are topologically sorted by their FK references, so a
  target (e.g. `Manufacturer`) is migrated before its dependants (`DeviceType`).
- **Id remapping** — NetBox ids differ from the new paas2box ids, so a per-table id map
  rewrites every FK; self- and forward-references are resolved in a final **link pass**.

Objects are created **page by page** as they stream in (bounded memory, smooth progress);
choice fields `{value,label}` collapse to `.value` and nested FK briefs map to the remapped
id. Tags / M2M relations are not migrated yet (scalar fields + FKs only).

### Run it

**From the web UI** — open the SPA, click **NetBox Migrate** in the sidebar, fill in the
NetBox URL + API token, and watch the progress bar climb (migrated / total).

**From the API:**

| Endpoint | Notes |
|----------|-------|
| `POST /api/plugins/netbox-migrate/run/` | start a migration; body below |
| `GET /api/plugins/netbox-migrate/progress/` | live counter: `migrated` / `total`, `percent`, `current`, `done` |
| `GET /api/plugins/netbox-migrate/ui/` | sidebar manifest (rendered by the SPA) |

```bash
# start in the background, then poll progress
curl -X POST http://localhost:8000/api/plugins/netbox-migrate/run/ \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://netbox.example.com","token":"<netbox-api-token>"}'

curl http://localhost:8000/api/plugins/netbox-migrate/progress/
```

Request body: `url` (NetBox base, required), `token` (NetBox API token, required), `only`
(optional array of table names/endpoints to restrict the run), `dry_run` (fetch + count
without writing), `wait` (run synchronously and return the full report instead of starting
in the background). Connectivity + token are checked up front (`502` if NetBox can't be
reached, `400` for a missing url/token, `409` if a migration is already running).

### Notes & caveats

- **NetBox API token**: needs read access to every object type you want to migrate. The
  client uses the classic `Authorization: Token <key>` header — on **NetBox 4.6+**, which
  defaults to hashed *v2* (`Bearer`) tokens, create a **v1** token for the migration.
- **Plugin entities** (e.g. `plugin_docker_host`) are migrated only when named in `only`
  *and* present on the source NetBox (i.e. that plugin is installed there).
- It is a **one-time import, not an upsert** — re-running against a database that already
  holds the objects fails on unique constraints. Start from a fresh/empty paas2box DB.
- Verified end-to-end against a real **NetBox 4.6.2** (`netbox-docker`): 138 objects
  migrated, 0 failed. Tests: [test/netbox-migrate.test.mjs](test/netbox-migrate.test.mjs).

## Regenerate everything

```bash
python3 datamodel/build_datamodel.py     # data model from the OpenAPI spec
python3 datamodel/build_schema.py        # SQLite + MariaDB DDL
node scripts/generate.mjs                 # TS types + metadata
npm run typecheck && npm test
```

## Status

Validated end-to-end on SQLite and MariaDB 11. See [`src/README.md`](src/README.md)
for the data-layer/API details and the current conformance gaps.

## License

The OpenAPI contract derives from NetBox (Apache-2.0).
