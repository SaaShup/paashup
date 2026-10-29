# Migrate from NetBox (built-in plugin)

Performs a one-shot import of a **live NetBox** instance into paashup over the REST API.
Because paashup mirrors the NetBox API, each entity is read from the *same* endpoint on
NetBox and written locally — so the engine only has to handle the two hard parts:

- **Dependency order** — entities are topologically sorted by their FK references, so a
  target (e.g. `Manufacturer`) is migrated before its dependants (`DeviceType`).
- **Id remapping** — NetBox ids differ from the new paashup ids, so a per-table id map
  rewrites every FK; self- and forward-references are resolved in a final **link pass**.

Objects are created **page by page** as they stream in (bounded memory, smooth progress);
choice fields `{value,label}` collapse to `.value` and nested FK briefs map to the remapped
id. Tags / M2M relations are not migrated yet (scalar fields + FKs only).

## Run it

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

Request body:

| Field | Notes |
|-------|-------|
| `url` | NetBox base URL, required |
| `token` | NetBox API token, required |
| `only` | optional array of table names/endpoints to restrict the run |
| `dry_run` | fetch + count without writing |
| `wait` | run synchronously and return the full report instead of starting in the background |

Connectivity + token are checked up front: `502` if NetBox can't be reached, `400` for a
missing url/token, `409` if a migration is already running.

## Notes & caveats

- **NetBox API token**: needs read access to every object type you want to migrate. The
  client uses the classic `Authorization: Token <key>` header — on **NetBox 4.6+**, which
  defaults to hashed *v2* (`Bearer`) tokens, create a **v1** token for the migration.
- **Plugin entities** (e.g. `plugin_docker_host`) are migrated only when named in `only`
  *and* present on the source NetBox (i.e. that plugin is installed there).
- It is a **one-time import, not an upsert** — re-running against a database that already
  holds the objects fails on unique constraints. Start from a fresh/empty paashup DB.
- Verified end-to-end against a real **NetBox 4.6.2** (`netbox-docker`): 138 objects
  migrated, 0 failed. Tests: [test/netbox-migrate.test.mjs](../../../test/netbox-migrate.test.mjs).
