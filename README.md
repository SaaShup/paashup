# paasbox

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
| [`src/`](src/) | TypeScript data layer + HTTP API (db abstraction, repository, serializer, auth) |
| [`scripts/`](scripts/) | `generate.mjs` — emits TS types + runtime metadata from the data model |
| [`test/`](test/) | `node:test` suites incl. an OpenAPI contract test (ajv) |

## Quick start

```bash
npm install
npm run build                              # tsc -> dist/

# SQLite
python3 migrations/migrate.py --dialect sqlite --database ./paasbox.db
PB_DIALECT=sqlite PB_SQLITE_FILE=./paasbox.db PORT=8000 npm start

# MariaDB
python3 migrations/migrate.py --dialect mariadb --database paasbox \
  --host 127.0.0.1 --user paasbox --password secret
PB_DIALECT=mariadb DB_NAME=paasbox DB_USER=paasbox DB_PASSWORD=secret npm start
```

Then e.g. `curl localhost:8000/api/dcim/manufacturers/`.

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
- **OpenAPI conformance** enforced by `test/contract.test.mjs` (validates live
  responses against the NetBox read schemas with `ajv`).

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
