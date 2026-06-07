# paas2box data-access layer (TypeScript, no ORM)

Raw-SQL data layer for the NetBox-compatible entities, running over **SQLite**
(small customers) or **MariaDB** (big customers) behind one async interface. No
ORM — a single metadata-driven `Repository` serves all 82 entities, with types
and table metadata generated from `datamodel/data-model.json`.

## Layout

```
src/
  db/            Dialect abstraction
    types.ts       Db interface (query/get/execute/transaction)
    sqlite.ts      SqliteDb  — node:sqlite (built-in, synchronous, wrapped async)
    mariadb.ts     MariaDb   — mysql2 pool
    index.ts       createDb(config)
  model/
    meta-types.ts  ColumnMeta / TableMeta (hand-written)
    types.ts       GENERATED — interfaces + Create/Update + TableTypeMap
    metadata.ts    GENERATED — runtime table/column metadata
  repository/
    repository.ts  Generic Repository<TRow, TCreate, TUpdate>
    index.ts       repository(db, table) typed factory
  index.ts         Public exports
scripts/generate.mjs   Regenerates model/types.ts + model/metadata.ts
test/                  node:test smoke tests (SQLite + MariaDB)
```

## Usage

```ts
import { createDb, repository } from 'paas2box';

const db = createDb({ dialect: 'sqlite', filename: './paas2box.db' });
// or: createDb({ dialect: 'mariadb', database: 'paas2box', host: '...', user: '...', password: '...' })

const devices = repository(db, 'dcim_device');          // fully typed by table name

const created = await devices.create({                  // DeviceCreate (writable cols, FKs as ids)
  name: 'sw1', device_type: 1, role: 1, site: 1, status: 'active',
});
const page  = await devices.list({ filters: { status: 'active' }, limit: 50, offset: 0 });
const one   = await devices.retrieve(created.id);       // Device | undefined
await devices.update(created.id, { comments: 'core switch' });
await devices.destroy(created.id);

await db.transaction(async (tx) => {
  await repository(tx, 'ipam_prefix').create({ prefix: '10.0.0.0/8', status: 'active' });
});
```

## Design notes

- **One `?`-placeholder dialect.** SQLite and MariaDB both use `?`, so SQL strings
  are shared. LIMIT/OFFSET are inlined as validated integers (some drivers reject
  them as bound params).
- **Logical names vs columns.** Objects use API field names (`vrf`); the repository
  maps them to physical columns (`vrf_id`) via the generated metadata. FK values
  are plain ids in this layer (the API serialization layer will expand to nested
  objects later).
- **Coercion.** JSON columns are `JSON.stringify`d on write and parsed on read;
  booleans round-trip `0/1 ↔ true/false`; MariaDB is set to `dateStrings` +
  `decimalNumbers` so values match SQLite.
- **Read-only entities** (e.g. `dcim_cable_termination`) reject create/update/delete.
- **Generated, not hand-written.** Re-run `npm run generate` after changing the
  data model so types/metadata stay in lockstep with the SQL schema.

## Commands

```bash
npm install
npm run generate     # regenerate src/model/{types,metadata}.ts from data-model.json
npm run typecheck    # tsc --noEmit
npm run build        # tsc -> dist/   (add a "build" script: "tsc")
node --test test/smoke.mjs                              # SQLite (after `npx tsc`)
DB_PORT=13306 node --test test/smoke-mariadb.mjs        # MariaDB (needs a server + schema)
```

## Status

Validated end-to-end: **8/8 SQLite** and **6/6 MariaDB** smoke tests pass with the
same repository code (CRUD, FK enforcement, JSON/bool round-trip, filtering,
pagination, unique constraints, read-only guard, transaction rollback).

## HTTP API layer (`src/api/`)

A `node:http` server exposes every entity at its NetBox path with the NetBox
response shape. Routing is metadata-driven (no per-entity route files).

```bash
PB_DIALECT=sqlite PB_SQLITE_FILE=./paas2box.db PORT=8000 npm start
# or PB_DIALECT=mariadb DB_HOST=.. DB_USER=.. DB_PASSWORD=.. DB_NAME=paas2box npm start
```

Per entity: `GET/POST /api/<app>/<resource>/` and
`GET/PUT/PATCH/DELETE /api/<app>/<resource>/{id}/`.

- **List** → `{ count, next, previous, results }`. Query params: `limit`, `offset`,
  `ordering` (comma list, `-` = desc), `q` (free-text), and filters with lookups:
  `status=active`, `name__ic=core`, `vid__gte=100`, `role__in=a,b`, `vrf__n=1`,
  `tenant__empty=true`.
- **Serialization** (`api/serializer.ts`): adds `id`, `url`, `display`; FK fields
  expand to nested briefs (`{id, url, display, name/slug, …}`); choice fields render
  as `{value, label}`; `tags: []` is always present.
- **Batched FK expansion**: `Serializer.objects()` collects every referenced id
  across the result set and loads each target table in a single `IN (...)` query
  (via `Repository.retrieveMany`), then renders synchronously. A list of N rows
  costs ~1 query per distinct FK target table, not N×(#FKs) — measured: 100 devices
  serialize in **3 queries** (vs 300+ for N+1).
- **Validation**: create/update bodies are checked before hitting the DB
  (required, enum choice, type, max-length); failures return `400` with the
  NetBox field-error shape `{ "name": ["This field is required."] }`. Other
  errors: DB FK/unique/not-null → `400 {detail}`; unknown route `404`;
  unsupported method / read-only entity `405`.
- **Generic relations**: `scope`/`assigned_object` etc. are stored as
  `<rel>_type` (content-type) + `<rel>_id` and serialized with a resolved nested
  `<rel>` object (batched, same as FKs). Writable via the `_type`/`_id` columns.
- **Computed fields**: `family` (`{value,label}` from the IP) for IP-bearing
  models; `children` + `_depth` for parent-FK tree models (Region, Location, …);
  reverse-FK `*_count` fields (`device_count`, `devicetype_count`, …), resolved at
  generation time and computed with one grouped query each. `display_url` (web-UI
  URL) is emitted alongside `url`. Non-nullable blanks serialize as type defaults
  (`""`/`{}`/`false`/`0`), matching NetBox.
- **OpenAPI conformance**: `test/contract.test.mjs` validates live responses
  against the extracted NetBox read schemas with `ajv`; `datamodel/coverage.py`
  reports per-entity field gaps (48/82 entities fully field-conformant; the rest
  miss complex subsystems — cable tracing, `config_context`, `primary_ip`, MAC).
- **Self-describing schema**: `GET /api/schema/` returns a valid OpenAPI 3.0
  document generated at runtime from the registry (core **and** plugin entities,
  reflecting the actual response shapes); `GET /api/schema/swagger-ui/` renders it.
  Both are public even when token auth is required. See `api/openapi.ts`.
- **Auth**: optional token auth (`Authorization: Token <key>`), enabled with
  `ServerOptions.auth = { required: true }` (or `PB_AUTH_REQUIRED=1`). Anonymous →
  `403` when required; read-only tokens get `403` on writes; expired tokens
  rejected. Tokens live in `auth_token` (migration `0002`); provision with
  `createToken(db, { userId })`.
- **Bulk create**: POST an array → all rows created in one transaction.
- **Tags & M2M**: writable on create/update as arrays of ids or `{id|name|slug}`
  (tags auto-create by name, NetBox-style); returned as nested-brief arrays. Writes
  use replace semantics (PATCH a relation = set it; omit it = leave untouched).
  Reads are batched (one query per relation per page). The polymorphic
  `tagging_taggeditem` table backs `tags`; bidirectional M2M (e.g. `ASN.sites` /
  `Site.asns`) share a single canonical join table.

The base URL for `url`/`next`/`previous` is derived from the request `Host` header
(override with `ServerOptions.baseUrl`).

## Validated

End-to-end (run after `npx tsc`): **48/48 SQLite** tests across `test/*.mjs`
(smoke, api, batching, relations, validation, generic-relations, computed, auth)
plus the **6/6 MariaDB** repository suite; all four newer features re-checked
against a live MariaDB 11.

## Not yet built (next steps)

- **Model-specific `*_count` fields** (e.g. `Site.device_count`) — need per-field
  relationship aggregation; currently omitted (not returned as 0).
- **Prefix `children`/`_depth`** are containment-based in NetBox (not a parent FK),
  so they are not yet computed (tree models with a `parent` FK are).
- **Cookie/session auth** and a `/api/users/tokens/` management endpoint (token
  auth + `createToken()` provisioning exist).
- **Write-side relation validation** (e.g. enforcing required generic-relation
  pairs) beyond the current type/choice/required checks.
