// End-to-end smoke test of the data layer against a real SQLite database built
// from the generated schema. Run: node --test test/smoke.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { repository } from '../dist/repository/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.smoke.sqlite');

let db;

before(() => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  const schema = readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8');
  db.exec(schema);
});

after(async () => {
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('create + retrieve with FK and type coercion', async () => {
  const manufacturers = repository(db, 'dcim_manufacturer');
  const m = await manufacturers.create({ name: 'Acme', slug: 'acme' });
  assert.equal(m.name, 'Acme');
  assert.equal(typeof m.id, 'number');

  const types = repository(db, 'dcim_device_type');
  const dt = await types.create({ manufacturer: m.id, model: 'Box 1U', slug: 'box-1u' });
  assert.equal(dt.manufacturer, m.id); // FK stored/read as id under logical name

  const got = await types.retrieve(dt.id);
  assert.equal(got.model, 'Box 1U');
});

test('JSON + boolean round-trip', async () => {
  const prefixes = repository(db, 'ipam_prefix');
  const p = await prefixes.create({
    prefix: '10.0.0.0/8',
    status: 'active',
    is_pool: true,
    custom_fields: { team: 'core', tags: [1, 2, 3] },
  });
  assert.equal(p.is_pool, true); // 1 -> boolean
  assert.deepEqual(p.custom_fields, { team: 'core', tags: [1, 2, 3] }); // TEXT -> parsed JSON
  const again = await prefixes.retrieve(p.id);
  assert.deepEqual(again.custom_fields, { team: 'core', tags: [1, 2, 3] });
});

test('list with filters, pagination, count', async () => {
  const rirs = repository(db, 'ipam_rir');
  for (const n of ['RIPE', 'ARIN', 'APNIC']) await rirs.create({ name: n, slug: n.toLowerCase() });
  const all = await rirs.list();
  assert.equal(all.count, 3);
  assert.equal(all.results.length, 3);

  const filtered = await rirs.list({ filters: { slug: 'arin' } });
  assert.equal(filtered.count, 1);
  assert.equal(filtered.results[0].name, 'ARIN');

  const page = await rirs.list({ limit: 2, offset: 0, orderBy: 'name', descending: false });
  assert.equal(page.results.length, 2);
  assert.equal(page.results[0].name, 'APNIC'); // alphabetical
});

test('update and destroy', async () => {
  const roles = repository(db, 'ipam_role');
  const r = await roles.create({ name: 'Loopbacks', slug: 'loopbacks' });
  const updated = await roles.update(r.id, { description: 'Loopback prefixes' });
  assert.equal(updated.description, 'Loopback prefixes');
  assert.equal(updated.name, 'Loopbacks'); // unchanged

  assert.equal(await roles.destroy(r.id), true);
  assert.equal(await roles.retrieve(r.id), undefined);
  assert.equal(await roles.destroy(r.id), false); // already gone
});

test('FK violation is rejected', async () => {
  const types = repository(db, 'dcim_device_type');
  await assert.rejects(
    () => types.create({ manufacturer: 999999, model: 'Ghost', slug: 'ghost' }),
    /FOREIGN KEY|constraint/i,
  );
});

test('unique constraint is enforced', async () => {
  const m = repository(db, 'dcim_manufacturer');
  await m.create({ name: 'Dup', slug: 'dup' });
  await assert.rejects(() => m.create({ name: 'Dup2', slug: 'dup' }), /UNIQUE|constraint/i);
});

test('read-only entity refuses writes', async () => {
  const ct = repository(db, 'dcim_cable_termination');
  await assert.rejects(() => ct.create({}), /read-only/);
});

test('transaction rolls back on error', async () => {
  const tenants = repository(db, 'tenancy_tenant');
  await assert.rejects(() =>
    db.transaction(async (tx) => {
      await repository(tx, 'tenancy_tenant').create({ name: 'T1', slug: 't1' });
      throw new Error('boom');
    }),
  );
  const after = await tenants.list({ filters: { slug: 't1' } });
  assert.equal(after.count, 0); // rolled back
});
