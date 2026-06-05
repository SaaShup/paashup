# Migrations (no ORM)

Plain-SQL schema migrations for paasbox, applied by a tiny runner. Two dialects:
**SQLite** (small customers) and **MariaDB** (big customers). Both are generated
from `datamodel/data-model.json` by `datamodel/build_schema.py` — do not hand-edit
`0001_initial.*`; add new migrations as higher-numbered files.

## Naming

```
<version>.<dialect>.sql      0001_initial.sqlite.sql
                             0001_initial.mariadb.sql
```

Files apply in ascending filename order. Applied versions are recorded in a
`schema_migrations` table, so re-running only applies what's pending.

## Apply

```bash
# SQLite
python migrations/migrate.py --dialect sqlite --database ./paasbox.db

# MariaDB (PyMySQL if installed, otherwise the mariadb/mysql CLI)
python migrations/migrate.py --dialect mariadb --database paasbox \
    --host 127.0.0.1 --port 3306 --user paasbox --password secret

# Show applied / pending without changing anything
python migrations/migrate.py --dialect sqlite --database ./paasbox.db --status
```

Connection params also fall back to env vars: `DB_HOST DB_PORT DB_USER
DB_PASSWORD DB_NAME DB_SOCKET`.

## Adding a migration

1. Change the model (`datamodel/data-model.json` via `build_datamodel.py`).
2. Hand-write `000N_<name>.sqlite.sql` and `000N_<name>.mariadb.sql` with the
   incremental `ALTER`/`CREATE` for the change (the generator emits the full
   schema, not diffs — diffs are authored per change).
3. Run the runner; it applies only the new version.

## Migrations

- `0001_initial` — full schema (93 tables) generated from `data-model.json`.
- `0002_auth_token` — hand-written `auth_token` table for token authentication.

## Validation status

The migrations have been executed end-to-end (0001 + 0002 applied in order by the
runner, on SQLite and MariaDB):

- **SQLite** — in-memory; FK enforcement + unique constraints verified.
- **MariaDB 11** — real server; 94 tables, 243 FKs, FK/unique/enum-CHECK/JSON all
  enforced.
