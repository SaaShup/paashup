# paasbox-plugin-example (starter template)

A starter for a **paasbox plugin** in its own repo. A plugin is a single
default-exported `Plugin` object; the host paasbox turns its entity metadata into a
full NetBox-shaped CRUD API automatically, and also mounts its custom routes, fires
its hooks, applies its migrations, and registers its custom fields.

There is **no runtime dependency on paasbox** — the author-time types are vendored
in [`types/paasbox.d.ts`](types/paasbox.d.ts), and the built plugin (plain JS) is
loaded by a running paasbox host.

## Use it

```bash
cp -r templates/plugin-starter ~/paasbox-plugin-myapp   # from a paasbox checkout
cd ~/paasbox-plugin-myapp
git init && npm install
# edit src/index.ts (rename "example", replace the Widget entity with yours)
npm run build        # -> dist/index.js
```

## See it live

Point any paasbox host at your built plugin with `PB_PLUGINS` (absolute path), then
start it. Using a paasbox checkout:

```bash
cd /path/to/paasbox
npm run build
node scripts/migrate-sqlite.mjs ./dev.db              # core schema (no Python needed)
PB_SQLITE_FILE=./dev.db \
PB_PLUGINS=/abs/path/to/paasbox-plugin-myapp/dist/index.js \
  node dist/main.js
```

Now:

- `GET /api/plugins/example/widgets/` — full CRUD (list/create/retrieve/update/delete)
- `POST /api/plugins/example/widgets/` `{"name":"w1","status":"active"}`
- `GET /api/plugins/example/summary/` — your custom route
- it also appears in `/api/schema/` and in the web UI's **Browse** dropdown, live.

## Ship it (so hosts auto-discover it)

Publish as `paasbox-plugin-<name>`; a host discovers it when it's a dependency
(`paasbox-plugin-*`) or listed in the host's `package.json` `paasbox.plugins`.

## The five extension points (see `src/index.ts`)

1. **entities** — `TableMeta` → automatic CRUD, pagination, filtering, choices as
   `{value,label}`, FK nested briefs, validation, all from one definition.
2. **migrations** — ordered, per-dialect SQL, tracked once in `schema_migrations`.
3. **routes** — custom non-CRUD endpoints under `/api/plugins/<name>/`.
4. **hooks** — react to `created`/`updated`/`deleted` writes.
5. **customFields** — attach fields to core or plugin entities (stored in
   `custom_fields`), validated on write, defaulted on read.

Porting an existing NetBox plugin? See `docs/PLUGIN-PORTING.md` in the paasbox repo.
