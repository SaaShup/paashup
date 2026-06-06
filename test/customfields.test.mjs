// Custom fields: plugins attach extra fields to core entities (stored in the
// custom_fields column), validated on write and defaulted on read.
// Run: node --test test/customfields.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import inventoryPlugin from '../dist/plugins/examples/inventory.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.cf.sqlite');
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
  await loadPlugins(db, [inventoryPlugin]); // registers custom fields on dcim_manufacturer
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('defined custom fields are filled with defaults on read', async () => {
  const m = await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' });
  assert.equal(m.status, 201);
  assert.deepEqual(m.body.custom_fields, { owner_team: '', tier: 'bronze', monitored: false });
});

test('custom field values round-trip and validate', async () => {
  const m = await api('POST', '/api/dcim/manufacturers/', {
    name: 'Beta',
    slug: 'beta',
    custom_fields: { owner_team: 'neteng', tier: 'gold', monitored: true },
  });
  assert.equal(m.status, 201);
  assert.deepEqual(m.body.custom_fields, { owner_team: 'neteng', tier: 'gold', monitored: true });

  const got = await api('GET', `/api/dcim/manufacturers/${m.body.id}/`);
  assert.equal(got.body.custom_fields.tier, 'gold');

  // PATCH a single custom field; others keep their stored values
  const patched = await api('PATCH', `/api/dcim/manufacturers/${m.body.id}/`, {
    custom_fields: { owner_team: 'neteng', tier: 'silver', monitored: true },
  });
  assert.equal(patched.body.custom_fields.tier, 'silver');
});

test('invalid custom field values are rejected with nested errors', async () => {
  const badChoice = await api('POST', '/api/dcim/manufacturers/', {
    name: 'C1',
    slug: 'c1',
    custom_fields: { tier: 'platinum' },
  });
  assert.equal(badChoice.status, 400);
  assert.match(badChoice.body.custom_fields.tier[0], /not a valid choice/);

  const badType = await api('POST', '/api/dcim/manufacturers/', {
    name: 'C2',
    slug: 'c2',
    custom_fields: { monitored: 'yes' },
  });
  assert.equal(badType.status, 400);
  assert.ok(badType.body.custom_fields.monitored);

  const unknown = await api('POST', '/api/dcim/manufacturers/', {
    name: 'C3',
    slug: 'c3',
    custom_fields: { nope: 1 },
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.custom_fields.nope[0], /Unknown custom field/);
});

test('entities without custom fields are unaffected', async () => {
  const r = await api('POST', '/api/ipam/rirs/', { name: 'RIPE', slug: 'ripe' });
  assert.equal(r.status, 201);
  // no custom fields registered for ipam_rir → custom_fields stays the stored default {}
  assert.deepEqual(r.body.custom_fields, {});
});
