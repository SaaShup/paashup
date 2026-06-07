// Devices use a UUID primary key; uniqueness is on the UUID only.
// Run: node --test test/device-uuid.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.devuuid.sqlite');
let db, server, base, fixtures;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const id = (r) => r.body.id;

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const mfr = await api('POST', '/api/dcim/manufacturers/', { name: 'm', slug: 'm' });
  const dt = await api('POST', '/api/dcim/device-types/', {
    manufacturer: id(mfr),
    model: 'dt',
    slug: 'dt',
  });
  const role = await api('POST', '/api/dcim/device-roles/', { name: 'r', slug: 'r' });
  const site = await api('POST', '/api/dcim/sites/', { name: 's', slug: 's', status: 'active' });
  fixtures = { dt: id(dt), role: id(role), site: id(site) };
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

const mkDevice = (name) =>
  api('POST', '/api/dcim/devices/', {
    name,
    device_type: fixtures.dt,
    role: fixtures.role,
    site: fixtures.site,
    status: 'active',
  });

test("a device's id is a UUID", async () => {
  const r = await mkDevice('dev1');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(String(r.body.id), UUID_RE);
});

test('devices are addressable + listable by their UUID', async () => {
  const r = await mkDevice('dev2');
  const got = await api('GET', `/api/dcim/devices/${r.body.id}/`);
  assert.equal(got.status, 200);
  assert.equal(got.body.id, r.body.id);
  const list = await api('GET', '/api/dcim/devices/');
  assert.ok(list.body.results.every((d) => UUID_RE.test(String(d.id))));
});

test('uniqueness is on the UUID only (duplicate name+site allowed)', async () => {
  const a = await mkDevice('dup');
  const b = await mkDevice('dup'); // same name + same site → previously rejected, now OK
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.id, b.body.id);
});

test('device role is optional', async () => {
  const r = await api('POST', '/api/dcim/devices/', {
    name: 'no-role',
    device_type: fixtures.dt,
    site: fixtures.site,
    status: 'active',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.role, null);
});

test('FKs to a device use the UUID (interface -> device brief)', async () => {
  const dev = await mkDevice('with-iface');
  const iface = await api('POST', '/api/dcim/interfaces/', {
    device: dev.body.id,
    name: 'eth0',
    type: '1000base-t',
  });
  assert.equal(iface.status, 201, JSON.stringify(iface.body));
  // device is expanded as a nested brief whose id is the UUID
  assert.equal(iface.body.device.id, dev.body.id);
  assert.match(String(iface.body.device.id), UUID_RE);
});
