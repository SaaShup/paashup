# Porting a NetBox plugin to paas2box

This is a self-contained guide (and handoff doc) for turning an existing **NetBox
plugin** into a **paas2box plugin**. It assumes no prior context beyond this file
plus the paas2box plugin contract in [`../src/plugins/`](../src/plugins/) and the
worked example [`../src/plugins/examples/inventory.ts`](../src/plugins/examples/inventory.ts).

## Mental model

NetBox plugins are Django apps: models + migrations + serializers + viewsets + URLs
+ signals + templates. paas2box is **metadata-driven and ORM-free**, so most of that
collapses: you describe your **entities as metadata** and ship the **SQL** to create
them; the generic engine produces the REST API (CRUD, pagination, filtering, nested
FKs, `{value,label}` choices, validation, OpenAPI schema, and the live UI) for free.

A paas2box plugin is **one module that default-exports a `Plugin` object** and has
**no runtime dependency on paas2box** (the host provides everything). Author-time
types are vendored (see the starter template) or imported from paas2box.

## Where it lives

Its own repo, `paas2box-plugin-<name>`. Start from
[`../templates/plugin-starter/`](../templates/plugin-starter/): copy it out, `npm
install`, edit `src/index.ts`, `npm run build`, then load into a host with
`PB_PLUGINS=/abs/path/dist/index.js` (or publish it and let discovery find it).

## Mapping

| NetBox | paas2box |
|--------|---------|
| `models.py` model | one `entities[].meta` (`TableMeta`) **+** a `migrations[]` entry (per-dialect `CREATE TABLE`) |
| model field | a `columns[]` entry (`tsKind`, `nullable`, `writable`, `required`, `maxLength`) |
| `ForeignKey` | a column with `references: '<TargetModel>'`; stored as `<name>_id`, serialized as a nested brief |
| `choices` / `ChoiceSet` | column `enum: [...]` (+ optional `enumLabels`) → API returns `{value,label}` |
| `ManyToManyField` | a `relations[]` entry (`kind:'m2m'`) + its join table in a migration; or `kind:'tags'` for tagging |
| `JSONField` | `tsKind: 'json'` |
| Serializers | **delete them** — serialization is automatic |
| API `ViewSet` + `urls.py` (standard CRUD) | **delete them** — CRUD is automatic from the entity |
| API extra/custom actions | `routes[]` (custom endpoints under `/api/plugins/<name>/`) |
| `signals` (`post_save`, `post_delete`) | `hooks[]` (`created`/`updated`/`deleted`) |
| custom fields | `customFields[]` (attach to core or plugin tables) |
| Django migrations | `migrations[]`, ordered, tracked once as `plugin:<name>:<version>` |
| `PluginConfig`, `navigation.py`, `template_content.py`, forms, templates | **not needed** — API-only; the UI is generated from the schema |
| `graphql/` | not supported (REST + OpenAPI + WebSocket only) |

## Step by step

1. **Scaffold.** Copy `templates/plugin-starter` → new repo; set `name` to
   `paas2box-plugin-<name>` and the `NAME`/endpoints in `src/index.ts`.
2. **Entities.** For each NetBox model, write a `TableMeta`:
   - `table`: `plugin_<name>_<thing>`; `endpoint`: `/api/plugins/<name>/<things>/`;
     `objectType`: `plugins.<thing>`; `origin: 'plugin'`.
   - `columns`: one per field. Use `references` for FKs (point at the **target
     model name** — core ones like `Site`, `Device`, `Tenant`, or your own).
     Include `created`/`last_updated` as read-only string columns if you want
     NetBox-style timestamps.
3. **Migrations.** One `{version, sqlite, mariadb}` with `CREATE TABLE IF NOT
   EXISTS …` matching your columns (FK columns are `<name>_id`). Add M2M join tables
   here too. Use `IF NOT EXISTS`; later schema changes are new versions.
4. **Custom endpoints.** Move non-CRUD viewset actions into `routes[]`. The handler
   gets `{ db, params, query, body }` and returns `{ status, body }`; query the DB
   with parameterized SQL (`db.query`, `db.execute`, `db.transaction`).
5. **Signals → hooks.** Convert `post_save`/`post_delete` receivers to `hooks[]`.
   (Hooks fire after a successful **API** write.)
6. **Custom fields.** Convert plugin-defined custom fields to `customFields[]`,
   targeting the relevant tables.
7. **Build & run.** `npm run build`, then load via `PB_PLUGINS` and exercise
   `/api/plugins/<name>/…`; confirm it shows in `/api/schema/` and the UI.

## What does NOT port (and the paas2box alternative)

- **Templates / UI views / forms / navigation** — the paas2box UI auto-generates
  list/detail/create/edit from the schema; you get UI for free, but bespoke pages
  aren't a plugin concern yet.
- **Background jobs / RQ workers** — not built in; do async work in a hook or an
  external worker hitting the API.
- **GraphQL** — not supported.
- **Permissions/RBAC** — paas2box has token auth (read-only vs read-write); NetBox's
  object-level permissions don't have an equivalent yet.

## Gotchas

- **FK values** in writes are plain ids (`{"site": 3}`), not nested objects; reads
  return nested briefs.
- **Enums**: send the bare value on write (`"status":"active"`); reads return
  `{value,label}`.
- **Non-nullable blanks** come back as type defaults (`""`/`{}`/`false`/`0`).
- **Booleans** are `0/1` in SQL but `true/false` over the API.
- Both SQLite and MariaDB use `?` placeholders, so your route SQL is portable; just
  provide both dialect strings in migrations.
- Validation/440-style field errors are produced automatically from the metadata
  (required/enum/type/maxLength) — you usually don't write validators.

## Fast handoff to a fresh Claude Code thread

In the new plugin repo, start a thread and say:

> Port this NetBox plugin to a paas2box plugin. The contract is documented at
> github.com/SaaShup/paas2box — read `docs/PLUGIN-PORTING.md`,
> `src/plugins/README.md`, `src/plugins/examples/inventory.ts`, and the type files
> under `src/plugins/` and `src/model/meta-types.ts`. I started from
> `templates/plugin-starter`. Here is my NetBox plugin: «paste models.py / views /
> signals».
