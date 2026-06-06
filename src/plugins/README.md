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
  entities: [{ meta /* TableMeta */, migration: { sqlite, mariadb } }],
  routes:  [{ method: 'GET', path: '/api/plugins/inventory/stats/', handler }],
  hooks:   [{ table: 'plugin_inventory_asset', event: 'created', handler }],
};
export default plugin;
```

See [`examples/inventory.ts`](examples/inventory.ts) for a complete, working example
(entity + custom route + hook).

### Entities → automatic CRUD

Provide a `TableMeta` (the same shape core entities use — see
[`../model/meta-types.ts`](../model/meta-types.ts)) with an `endpoint` under
`/api/plugins/<name>/<resource>/`, plus idempotent `CREATE TABLE IF NOT EXISTS` DDL
for each dialect. On load the entity is registered and its table ensured; it then
gets, for free:

- `GET/POST /…/`, `GET/PUT/PATCH/DELETE /…/{id}/`
- pagination envelope, query lookups (`__ic`, `__in`, `__gte`, `q`, `ordering`)
- choice fields as `{value,label}`, FK nested briefs, `url`/`display`/`display_url`
- pre-write validation (required/enum/type/maxlength) with NetBox field-error shape

A plugin entity can reference **core** tables (FKs, tags) by pointing `references` /
relations at core table names.

### Custom routes

For logic beyond CRUD, add routes. Paths may contain `{param}` segments; the handler
receives `{ db, params, query, body }` and returns `{ status, body }`. Custom routes
take precedence over generic CRUD.

### Hooks

React to API writes with `{ table, event: 'created'|'updated'|'deleted', handler }`.
Hooks fire after a successful API change (handler gets `{ db, id, row }`).

## Loading plugins

At runtime, set `PB_PLUGINS` to a comma-separated list of module specifiers; each is
imported and its default export loaded **before** the server starts:

```bash
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
- Plugin DDL is applied idempotently on load (use `IF NOT EXISTS`); there's no
  per-plugin versioned migration history yet (core uses `migrations/`).
- Hooks fire on **API** writes, not on direct repository use.
- Plugin entity types aren't in the generated `TableName`, so use
  `new Repository(db, getTable(name)!)` for typed-ish access in code.
