#!/bin/sh
set -e

# Volumes created before the rename to paashup hold /data/paas2box.db: keep using it.
if [ "$PB_SQLITE_FILE" = "/data/paashup.db" ] && [ ! -e /data/paashup.db ] && [ -e /data/paas2box.db ]; then
  export PB_SQLITE_FILE=/data/paas2box.db
fi

# Optionally apply SQLite migrations on startup (small-customer case).
# For MariaDB, run migrations separately (migrations/migrate.py or your tooling).
if [ "$PB_MIGRATE" = "1" ] && [ "${PB_DIALECT:-sqlite}" = "sqlite" ]; then
  node scripts/migrate-sqlite.mjs "${PB_SQLITE_FILE:-/data/paashup.db}"
fi

exec node dist/main.js
