// Regression: SQLite has no ALTER COLUMN, so a migration that changes an existing column's
// constraints (e.g. the Docker plugin's 0007_volume_max_size_default) rebuilds the table
// (CREATE __new, copy, DROP, RENAME). With `PRAGMA foreign_keys = ON` (the default connection
// setting — src/db/sqlite.ts), dropping a table other rows still reference via FK used to
// fail outright with "FOREIGN KEY constraint failed" on any database that already had real
// data (e.g. a volume mounted into a container), even though the rebuild immediately restores
// the table under its original name with the same row ids. This broke production on upgrade
// (the plugin's migrations are applied at every startup, not just on a fresh database).
// src/plugins/runtime.ts now toggles the pragma OFF/ON around each migration's own
// transaction (PRAGMA foreign_keys is itself a no-op *inside* a transaction, so it can't be
// done from within the migration's own SQL).
// Run: node --test test/docker-migration-fk.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { applyPluginMigrations, loadPlugins } from '../dist/plugins/runtime.js';
import dockerPlugin from '../dist/plugins/docker/index.js';
import {
  INITIAL_MIGRATION,
  HOST_SCOPE_MIGRATION,
  HOST_TOKEN_MIGRATION,
  VM_SSH_KEY_MIGRATION,
  CONTAINER_RESOURCE_LIMITS_MIGRATION,
  HOST_CA_PIN_MIGRATION,
} from '../dist/plugins/docker/migrations.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.docker-migration-fk.sqlite');

test('a table-rebuild migration succeeds on a database with rows other tables still reference by FK', async () => {
  rmSync(DB_FILE, { force: true });
  const db = new SqliteDb(DB_FILE);
  try {
    db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
    db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));

    // Pre-0007 state: every migration up to (but not including) the volume max_size one —
    // as if this were an existing production database about to be upgraded.
    await applyPluginMigrations(db, 'docker', [
      INITIAL_MIGRATION,
      HOST_SCOPE_MIGRATION,
      HOST_TOKEN_MIGRATION,
      VM_SSH_KEY_MIGRATION,
      CONTAINER_RESOURCE_LIMITS_MIGRATION,
      HOST_CA_PIN_MIGRATION,
    ]);

    // Real data: a volume (max_size NULL, pre-migration) mounted into a container — the
    // exact shape that made the production DROP TABLE fail (plugin_docker_mount.volume_id
    // REFERENCES plugin_docker_volume(id) ON DELETE RESTRICT).
    await db.execute(
      `INSERT INTO plugin_docker_host (id, endpoint, name) VALUES (1, 'http://a:1', 'h')`,
    );
    await db.execute(
      `INSERT INTO plugin_docker_registry (id, host_id, name, serveraddress) VALUES (1, 1, 'r', 'https://x/v2/')`,
    );
    await db.execute(`INSERT INTO plugin_docker_volume (id, host_id, name) VALUES (1, 1, 'data')`);
    await db.execute(
      `INSERT INTO plugin_docker_image (id, host_id, registry_id, name) VALUES (1, 1, 1, 'nginx')`,
    );
    await db.execute(
      `INSERT INTO plugin_docker_container (id, host_id, image_id, name) VALUES (1, 1, 1, 'c')`,
    );
    await db.execute(
      `INSERT INTO plugin_docker_mount (id, container_id, volume_id, source) VALUES (1, 1, 1, '/srv')`,
    );

    // loadPlugins now applies the remaining migrations, including the 0007 table rebuild —
    // this must NOT throw "FOREIGN KEY constraint failed".
    await loadPlugins(db, [dockerPlugin]);

    const [volume] = await db.query('SELECT id, max_size FROM plugin_docker_volume');
    assert.equal(volume.id, 1); // same row id survives the rebuild
    assert.equal(volume.max_size, 0); // backfilled from NULL

    const [mount] = await db.query('SELECT volume_id FROM plugin_docker_mount');
    assert.equal(mount.volume_id, 1); // the FK reference still resolves after the rebuild

    // the connection's own foreign-key enforcement is restored afterwards, not left disabled
    const pragma = await db.query('PRAGMA foreign_keys');
    assert.equal(pragma[0].foreign_keys, 1);
  } finally {
    await db.close();
    rmSync(DB_FILE, { force: true });
  }
});
