# paasbox plugins

paasbox is **metadata-driven**: the router, repository, serializer, validator and
all the NetBox-shaped behaviour (pagination, FK briefs, `{value,label}` choices,
filtering, computed fields) operate off a table-metadata registry. A plugin simply
**registers entity metadata + ships its DDL**, and the existing engine turns it into
a full NetBox-compatible CRUD API under `/api/plugins/<name>/…`. Plugins can also add
custom (non-CRUD) routes and react to writes via hooks.

## A plugin is one object

```ts
import type { Plugin } from 'paasbox';

const plugin: Plugin = {
  name: 'inventory',
  version: '0.1.0',
  entities:   [{ meta /* TableMeta */ }],
  migrations: [{ version: '0001_initial', sqlite, mariadb }],
  routes:     [{ method: 'GET', path: '/api/plugins/inventory/stats/', handler }],
  hooks:      [{ table: 'plugin_inventory_asset', event: 'created', handler }],
};
export default plugin;
```

See [`examples/inventory.ts`](examples/inventory.ts) for a complete, working example
(entity + custom route + hook).

### Entities → automatic CRUD

Provide a `TableMeta` (the same shape core entities use — see
[`../model/meta-types.ts`](../model/meta-types.ts)) with an `endpoint` under
`/api/plugins/<name>/<resource>/`, and the table's DDL as a `migrations` entry (see
below). On load the entity is registered; it then gets, for free:

- `GET/POST /…/`, `GET/PUT/PATCH/DELETE /…/{id}/`
- pagination envelope, query lookups (`__ic`, `__in`, `__gte`, `q`, `ordering`)
- choice fields as `{value,label}`, FK nested briefs, `url`/`display`/`display_url`
- pre-write validation (required/enum/type/maxlength) with NetBox field-error shape

A plugin entity can reference **core** tables (FKs, tags) by pointing `references` /
relations at core table names.

### Migrations

Declare ordered, per-dialect migrations at the plugin level:

```ts
migrations: [{ version: '0001_initial', sqlite: 'CREATE TABLE …', mariadb: 'CREATE TABLE …' }]
```

`loadPlugins` applies pending migrations in `version` order and records each in
`schema_migrations` as `plugin:<name>:<version>`, so every migration runs exactly
once (idempotent across restarts, on SQLite and MariaDB). Ship later schema changes
as additional versions (`0002_…`).

### Custom routes

For logic beyond CRUD, add routes. Paths may contain `{param}` segments; the handler
receives `{ db, params, query, body }` and returns `{ status, body }`. Custom routes
take precedence over generic CRUD.

### Hooks

React to API writes with `{ table, event: 'created'|'updated'|'deleted', handler }`.
Hooks fire after a successful API change (handler gets `{ db, id, row }`).

## Loading plugins

Plugins are discovered from the project's **package.json** and from the
`PB_PLUGINS` env list (merged), then imported and loaded **before** the server
starts:

```jsonc
// package.json
{
  "paasbox": { "plugins": ["./dist/plugins/examples/inventory.js"] },
  "dependencies": { "paasbox-plugin-acme": "^1.0.0" }  // paasbox-plugin-* auto-discovered
}
```

```bash
# or explicitly via env (comma-separated module specifiers)
PB_PLUGINS=paasbox/dist/plugins/examples/inventory.js npm start
```

Programmatically:

```ts
import { createDb, createApiServer, loadPlugins } from 'paasbox';
import inventory from 'paasbox/dist/plugins/examples/inventory.js';

const db = createDb({ dialect: 'sqlite', filename: './paasbox.db' });
await loadPlugins(db, [inventory]);   // register entities, apply DDL, mount routes/hooks
const server = createApiServer({ db });
```

## How it fits the architecture

- [`../model/registry.ts`](../model/registry.ts) — mutable table registry seeded from
  the generated core metadata; `registerEntity()` adds plugin tables. The
  router/serializer/repository all read from it.
- [`runtime.ts`](runtime.ts) — `loadPlugins` (register + migrate + mount), `matchRoute`,
  `fireHooks`.
- The HTTP server checks plugin routes first, then generic CRUD; it fires hooks after
  create/update/delete.

## Current limits (vs NetBox plugins)

- No UI/templates (paasbox is API-only).
- Hooks fire on **API** writes, not on direct repository use.
- Plugin entity types aren't in the generated `TableName`, so use
  `new Repository(db, getTable(name)!)` for typed-ish access in code.
