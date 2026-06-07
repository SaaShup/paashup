// Regression: a database built from the MIGRATION CHAIN (not schema.sql) must have
// the gateway column, so listing IP ranges doesn't 500. This is the scenario that a
// migrate-based deployment (Docker, migrate.py/migrate-sqlite) actually runs.
// Run: node --test test/iprange-migration.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const MIG = join(ROOT, 'migrations');
const DB = join(ROOT, 'test', '.mig.sqlite');
let db, server, base;

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  // apply every migration in order, exactly like scripts/migrate-sqlite.mjs
  const files = readdirSync(MIG)
    .filter((f) => f.endsWith('.sqlite.sql'))
    .sort((a, b) => a.localeCompare(b));
  for (const f of files) db.exec(readFileSync(join(MIG, f), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('listing IP ranges does not 500 on a migrated DB', async () => {
  const r = await api('GET', '/api/ipam/ip-ranges/');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok('results' in r.body);
});

test('gateway column exists after migrations (create + read works)', async () => {
  const r = await api('POST', '/api/ipam/ip-ranges/', {
    start_address: '10.0.0.1/24',
    end_address: '10.0.0.254/24',
    status: 'active',
    gateway: '10.0.0.1',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.gateway, '10.0.0.1');
  const list = await api('GET', '/api/ipam/ip-ranges/');
  assert.equal(list.status, 200);
  assert.equal(list.body.results[0].gateway, '10.0.0.1');
});
