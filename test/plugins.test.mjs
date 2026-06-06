// Plugin system: a plugin contributes an entity (auto-CRUD), a custom route, and
// a write hook — all NetBox-shaped. Run: node --test test/plugins.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { discoverPluginSpecifiers } from '../dist/plugins/discovery.js';
import inventoryPlugin from '../dist/plugins/examples/inventory.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.plugins.sqlite');
let db, server, base;
const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  // load the plugin BEFORE creating the server (registers entity + applies DDL)
  await loadPlugins(db, [inventoryPlugin]);
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('plugin entity gets full NetBox-shaped CRUD under /api/plugins/...', async () => {
  const created = await api('POST', '/api/plugins/inventory/assets/', {
    name: 'Cable box',
    serial: 'SN-1',
    quantity: 5,
    status: 'in-stock',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Cable box');
  assert.equal(created.body.url, `${base}/api/plugins/inventory/assets/${created.body.id}/`);
  assert.deepEqual(created.body.status, { value: 'in-stock', label: 'In stock' }); // enum {value,label}
  assert.equal(created.body.description, ''); // non-null blank default

  const got = await api('GET', `/api/plugins/inventory/assets/${created.body.id}/`);
  assert.equal(got.body.serial, 'SN-1');

  const patched = await api('PATCH', `/api/plugins/inventory/assets/${created.body.id}/`, {
    status: 'deployed',
  });
  assert.deepEqual(patched.body.status, { value: 'deployed', label: 'Deployed' });

  const page = await api('GET', '/api/plugins/inventory/assets/?status=deployed');
  assert.equal(page.body.count, 1);

  assert.equal(
    (await api('DELETE', `/api/plugins/inventory/assets/${created.body.id}/`)).status,
    204,
  );
});

test('plugin validation + enum enforcement reuse the core engine', async () => {
  const missing = await api('POST', '/api/plugins/inventory/assets/', { serial: 'x' });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body.name, ['This field is required.']);

  const badEnum = await api('POST', '/api/plugins/inventory/assets/', {
    name: 'a',
    status: 'nope',
  });
  assert.equal(badEnum.status, 400);
  assert.match(badEnum.body.status[0], /not a valid choice/);
});

test('custom plugin route + hook fire', async () => {
  await api('POST', '/api/plugins/inventory/assets/', { name: 'A', status: 'in-stock' });
  await api('POST', '/api/plugins/inventory/assets/', { name: 'B', status: 'deployed' });
  const stats = await api('GET', '/api/plugins/inventory/stats/');
  assert.equal(stats.status, 200);
  assert.ok(stats.body.total >= 2);
  assert.ok(stats.body.by_status.deployed >= 1);
  assert.ok(stats.body.created_via_hook >= 2); // 'created' hook incremented per POST
});

test('core API still works alongside the plugin', async () => {
  const m = await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' });
  assert.equal(m.status, 201);
  const list = await api('GET', '/api/ipam/rirs/');
  assert.equal(list.status, 200);
});

test('unknown plugin path 404s', async () => {
  assert.equal((await api('GET', '/api/plugins/nope/')).status, 404);
});

test('plugin migration is tracked once and idempotent on reload', async () => {
  const q = "SELECT version FROM schema_migrations WHERE version LIKE 'plugin:inventory:%'";
  let rows = await db.query(q);
  assert.deepEqual(
    rows.map((r) => r.version),
    ['plugin:inventory:0001_initial'],
  );
  // reloading must not re-apply the migration or throw
  await loadPlugins(db, [inventoryPlugin]);
  rows = await db.query(q);
  assert.equal(rows.length, 1);
});

test('discoverPluginSpecifiers reads package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pbx-disc-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      paasbox: { plugins: ['./local-plugin.js'] },
      dependencies: { 'paasbox-plugin-foo': '^1.0.0', mysql2: '^3' },
    }),
  );
  const specs = discoverPluginSpecifiers(dir);
  assert.ok(specs.includes('./local-plugin.js'));
  assert.ok(specs.includes('paasbox-plugin-foo'));
  assert.ok(!specs.includes('mysql2'));
  rmSync(dir, { recursive: true, force: true });
});
