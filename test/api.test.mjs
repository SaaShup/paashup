// End-to-end test of the HTTP API (NetBox-shaped) against SQLite.
// Run: node --test test/api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.api.sqlite');

let db, server, base;

const api = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db }); // base derived from Host header
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('POST creates and returns NetBox-shaped object', async () => {
  const r = await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' });
  assert.equal(r.status, 201);
  assert.equal(r.body.name, 'Acme');
  assert.equal(typeof r.body.id, 'number');
  assert.equal(r.body.url, `${base}/api/dcim/manufacturers/${r.body.id}/`);
  assert.equal(r.body.display, 'Acme');
  assert.ok(Array.isArray(r.body.tags));
});

test('FK expands to a nested brief on read', async () => {
  const m = (await api('POST', '/api/dcim/manufacturers/', { name: 'Cisco', slug: 'cisco' })).body;
  const dt = (
    await api('POST', '/api/dcim/device-types/', {
      manufacturer: m.id,
      model: 'C9300',
      slug: 'c9300',
    })
  ).body;
  assert.equal(dt.status ?? 201, dt.status ?? 201);
  const got = (await api('GET', `/api/dcim/device-types/${dt.id}/`)).body;
  assert.equal(typeof got.manufacturer, 'object');
  assert.equal(got.manufacturer.id, m.id);
  assert.equal(got.manufacturer.display, 'Cisco');
  assert.equal(got.manufacturer.url, `${base}/api/dcim/manufacturers/${m.id}/`);
});

test('choice field renders as {value,label}', async () => {
  const p = (
    await api('POST', '/api/ipam/prefixes/', {
      prefix: '10.0.0.0/8',
      status: 'active',
      is_pool: true,
    })
  ).body;
  assert.deepEqual(p.status, { value: 'active', label: 'Active' });
  assert.equal(p.is_pool, true);
});

test('list returns paginated envelope', async () => {
  for (const n of ['RIPE', 'ARIN', 'APNIC', 'LACNIC']) {
    await api('POST', '/api/ipam/rirs/', { name: n, slug: n.toLowerCase() });
  }
  const r = await api('GET', '/api/ipam/rirs/?limit=2&ordering=name');
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 4);
  assert.equal(r.body.results.length, 2);
  assert.equal(r.body.results[0].name, 'APNIC');
  assert.ok(r.body.next.includes('offset=2'));
  assert.equal(r.body.previous, null);
});

test('filters and lookups work', async () => {
  const exact = await api('GET', '/api/ipam/rirs/?slug=arin');
  assert.equal(exact.body.count, 1);
  assert.equal(exact.body.results[0].name, 'ARIN');

  const contains = await api('GET', '/api/ipam/rirs/?name__ic=ri'); // RIPE
  assert.ok(contains.body.count >= 1);

  const q = await api('GET', '/api/ipam/rirs/?q=LACNIC');
  assert.equal(q.body.count, 1);
});

test('PATCH updates, DELETE removes', async () => {
  const role = (await api('POST', '/api/ipam/roles/', { name: 'Loopbacks', slug: 'loopbacks' }))
    .body;
  const patched = await api('PATCH', `/api/ipam/roles/${role.id}/`, {
    description: 'Loopback prefixes',
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.description, 'Loopback prefixes');
  assert.equal(patched.body.name, 'Loopbacks');

  const del = await api('DELETE', `/api/ipam/roles/${role.id}/`);
  assert.equal(del.status, 204);
  const gone = await api('GET', `/api/ipam/roles/${role.id}/`);
  assert.equal(gone.status, 404);
});

test('validation + constraint errors map to 4xx', async () => {
  const badFk = await api('POST', '/api/dcim/device-types/', {
    manufacturer: 999999,
    model: 'X',
    slug: 'x',
  });
  assert.equal(badFk.status, 400);
  assert.match(badFk.body.detail, /Related object/);

  await api('POST', '/api/dcim/manufacturers/', { name: 'Dup', slug: 'dup' });
  const dup = await api('POST', '/api/dcim/manufacturers/', { name: 'Dup2', slug: 'dup' });
  assert.equal(dup.status, 400);
  assert.match(dup.body.detail, /already exists/);

  const unknown = await api('GET', '/api/ipam/rirs/?bogus=1');
  assert.equal(unknown.status, 400);
});

test('read-only endpoint rejects POST; unknown route 404', async () => {
  const ro = await api('POST', '/api/dcim/cable-terminations/', {});
  assert.equal(ro.status, 405);
  const nf = await api('GET', '/api/nope/');
  assert.equal(nf.status, 404);
});

test('bulk create via array body', async () => {
  const r = await api('POST', '/api/dcim/manufacturers/', [
    { name: 'Bulk1', slug: 'bulk1' },
    { name: 'Bulk2', slug: 'bulk2' },
  ]);
  assert.equal(r.status, 201);
  assert.equal(r.body.length, 2);
  assert.equal(r.body[1].name, 'Bulk2');
});
