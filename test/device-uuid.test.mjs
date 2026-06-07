// Devices get an auto-generated, read-only `uuid` reference on create.
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
let db, server, base;
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
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

async function makeDevice(name) {
  const mfr = await api('POST', '/api/dcim/manufacturers/', {
    name: `m-${name}`,
    slug: `m-${name}`,
  });
  const dt = await api('POST', '/api/dcim/device-types/', {
    manufacturer: id(mfr),
    model: `dt-${name}`,
    slug: `dt-${name}`,
  });
  const role = await api('POST', '/api/dcim/device-roles/', {
    name: `r-${name}`,
    slug: `r-${name}`,
  });
  const site = await api('POST', '/api/dcim/sites/', {
    name: `s-${name}`,
    slug: `s-${name}`,
    status: 'active',
  });
  return api('POST', '/api/dcim/devices/', {
    name,
    device_type: id(dt),
    role: id(role),
    site: id(site),
    status: 'active',
  });
}

test('creating a device auto-generates a uuid', async () => {
  const r = await makeDevice('dev1');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.uuid, UUID_RE);
});

test('each device gets a distinct uuid; it is stable and read-only', async () => {
  const a = await makeDevice('dev2');
  const b = await makeDevice('dev3');
  assert.notEqual(a.body.uuid, b.body.uuid);

  // uuid is read-only: a client-supplied value on update is ignored
  const before = a.body.uuid;
  const upd = await api('PATCH', `/api/dcim/devices/${a.body.id}/`, {
    uuid: '00000000-0000-0000-0000-000000000000',
    comments: 'x',
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.uuid, before);
});
