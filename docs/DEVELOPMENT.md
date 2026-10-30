# Development guide

How to build paashup from source, work on the web UI, run the CI pipeline locally and
regenerate the generated code. For production setup, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Run from source

```bash
npm install
npm run build                              # tsc -> dist/

# SQLite
python3 migrations/migrate.py --dialect sqlite --database ./paashup.db
PB_DIALECT=sqlite PB_SQLITE_FILE=./paashup.db PORT=8000 npm start

# MariaDB
python3 migrations/migrate.py --dialect mariadb --database paashup \
  --host 127.0.0.1 --user paashup --password secret
PB_DIALECT=mariadb DB_NAME=paashup DB_USER=paashup DB_PASSWORD=secret npm start
```

Then e.g. `curl localhost:8000/api/dcim/manufacturers/`. The live OpenAPI schema is
at `GET /api/schema/` (Swagger UI at `/api/schema/swagger-ui/`), generated from the
registry so it always reflects core **and** any loaded plugins.

Auth is required by default: seed a token with `node scripts/seed-token.mjs <db-file>`
(prints a generated key), or set `PB_AUTH_REQUIRED=0` for local dev only.

## Web UI (hot reload)

Two processes:

```bash
# Terminal 1 — backend (API + WebSocket on :8000)
npm install && npm run build
node scripts/migrate-sqlite.mjs ./paashup.db          # create the SQLite schema (no Python)
PB_SQLITE_FILE=./paashup.db node dist/main.js

# Terminal 2 — Vue dev server (proxies /api and /api/ws to :8000)
cd web && npm install && npm run dev                  # then open http://localhost:5173
```

A fresh database is empty — click **+ Add** in the UI, or seed via the API. Full
details in [web/README.md](../web/README.md).

## Everyday commands

```bash
npm run ci              # run the whole pipeline locally (mirrors GitHub Actions)
npm run lint            # ESLint (TS/JS)
npm run format          # Prettier write  (format:check in CI)
npm test                # build + SQLite test suite
ruff check . && ruff format --check .   # Python scripts
```

## Local CI

[`scripts/ci.sh`](../scripts/ci.sh) (aliased as `npm run ci`) runs the **same five
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

Example output:

```text
== summary ==
passed:  prettier eslint ruff-format ruff-check test (sqlite) npm-audit build (tsc) docker-image test (mariadb)
skipped: trivy
CI PASSED
```

### GitHub Actions

The same stages run in CI ([ci.yml](../.github/workflows/ci.yml)) as five jobs:
**test** (SQLite), **test-mariadb** (service container), **lint** (ESLint + Prettier +
Ruff), **security** (`npm audit` + Trivy CVE scan), and **build** (uploads the `dist/`
artifact and builds + smoke-tests the Docker image).

Pushing a version tag (`1.2.3` or `v1.2.3`) runs
[docker-publish.yml](../.github/workflows/docker-publish.yml): CI, then the image is
pushed to `ghcr.io/saashup/paashup` and the upgrade webhook is notified.

## Regenerate everything

The stack is generated from the NetBox OpenAPI spec. After changing the spec or the
generators:

```bash
python3 datamodel/build_datamodel.py     # data model from the OpenAPI spec
python3 datamodel/build_schema.py        # SQLite + MariaDB DDL
node scripts/generate.mjs                 # TS types + metadata
npm run typecheck && npm test
```
