#!/bin/sh
set -e

# Optionally apply SQLite migrations on startup (small-customer case).
# For MariaDB, run migrations separately (migrations/migrate.py or your tooling).
if [ "$PB_MIGRATE" = "1" ] && [ "${PB_DIALECT:-sqlite}" = "sqlite" ]; then
  node scripts/migrate-sqlite.mjs "${PB_SQLITE_FILE:-/data/paasbox.db}"
fi

exec node dist/main.js
