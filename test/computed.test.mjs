// Feature: computed fields (family, children, _depth). Run: node --test test/computed.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.cmp.sqlite');
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
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('family is computed for IPv4 and IPv6 prefixes', async () => {
  const v4 = (await api('POST', '/api/ipam/prefixes/', { prefix: '10.0.0.0/8', status: 'active' }))
    .body;
  const v6 = (
    await api('POST', '/api/ipam/prefixes/', { prefix: '2001:db8::/32', status: 'active' })
  ).body;
  assert.deepEqual(v4.family, { value: 4, label: 'IPv4' });
  assert.deepEqual(v6.family, { value: 6, label: 'IPv6' });
});

test('family for ip-addresses', async () => {
  const ip = (
    await api('POST', '/api/ipam/ip-addresses/', { address: '192.0.2.5/24', status: 'active' })
  ).body;
  assert.deepEqual(ip.family, { value: 4, label: 'IPv4' });
});

test('children and _depth for a Region tree', async () => {
  const root = (await api('POST', '/api/dcim/regions/', { name: 'World', slug: 'world' })).body;
  const eu = (await api('POST', '/api/dcim/regions/', { name: 'EU', slug: 'eu', parent: root.id }))
    .body;
  const fr = (await api('POST', '/api/dcim/regions/', { name: 'FR', slug: 'fr', parent: eu.id }))
    .body;
  await api('POST', '/api/dcim/regions/', { name: 'DE', slug: 'de', parent: eu.id });

  const rootGot = (await api('GET', `/api/dcim/regions/${root.id}/`)).body;
  const euGot = (await api('GET', `/api/dcim/regions/${eu.id}/`)).body;
  const frGot = (await api('GET', `/api/dcim/regions/${fr.id}/`)).body;

  assert.equal(rootGot._depth, 0);
  assert.equal(rootGot.children, 1); // EU
  assert.equal(euGot._depth, 1);
  assert.equal(euGot.children, 2); // FR + DE
  assert.equal(frGot._depth, 2);
  assert.equal(frGot.children, 0);
});

test('tree computed fields stay batched on list', async () => {
  db.queries = 0;
  const r = await api('GET', '/api/dcim/regions/?limit=50');
  assert.ok(
    r.body.results.every((x) => typeof x._depth === 'number' && typeof x.children === 'number'),
  );
  assert.ok(db.queries < 12, `expected batched, got ${db.queries}`);
  console.log(`  region list with depth/children in ${db.queries} queries`);
});

test('non-tree, non-IP entity has no spurious computed fields', async () => {
  const m = (await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' })).body;
  assert.equal('family' in m, false);
  assert.equal('_depth' in m, false);
});
