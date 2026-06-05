// Feature: generic (polymorphic) relations resolved to nested objects.
// Run: node --test test/generic-relations.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.gr.sqlite');
let db, server, base;
const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined,
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
after(async () => { await new Promise((r) => server.close(r)); await db.close(); rmSync(DB_FILE, { force: true }); });

test('Prefix.scope resolves to a nested object via content-type + id', async () => {
  const site = (await api('POST', '/api/dcim/sites/', { name: 'DC1', slug: 'dc1', status: 'active' })).body;
  const created = await api('POST', '/api/ipam/prefixes/', {
    prefix: '10.1.0.0/16', status: 'active', scope_type: 'dcim.site', scope_id: site.id,
  });
  assert.equal(created.status, 201);
  // raw fields preserved
  assert.equal(created.body.scope_type, 'dcim.site');
  assert.equal(created.body.scope_id, site.id);
  // nested accessor resolved
  assert.equal(typeof created.body.scope, 'object');
  assert.equal(created.body.scope.id, site.id);
  assert.equal(created.body.scope.display, 'DC1');
  assert.ok(created.body.scope.url.includes('/api/dcim/sites/'));

  const got = await api('GET', `/api/ipam/prefixes/${created.body.id}/`);
  assert.equal(got.body.scope.id, site.id);
});

test('no scope -> scope is null', async () => {
  const p = (await api('POST', '/api/ipam/prefixes/', { prefix: '10.2.0.0/16', status: 'active' })).body;
  assert.equal(p.scope, null);
  assert.equal(p.scope_id, null);
});

test('Cluster.scope to a different content-type (Site) resolves', async () => {
  const site = (await api('POST', '/api/dcim/sites/', { name: 'DC2', slug: 'dc2', status: 'active' })).body;
  const ctype = (await api('POST', '/api/virtualization/cluster-types/', { name: 'KVM', slug: 'kvm' })).body;
  const cl = await api('POST', '/api/virtualization/clusters/', {
    name: 'c1', type: ctype.id, scope_type: 'dcim.site', scope_id: site.id, status: 'active',
  });
  assert.equal(cl.status, 201);
  assert.equal(cl.body.scope.display, 'DC2');
  assert.equal(cl.body.type.display, 'KVM'); // regular FK still works alongside
});

test('generic relations batched on list', async () => {
  const site = (await api('POST', '/api/dcim/sites/', { name: 'DC3', slug: 'dc3', status: 'active' })).body;
  for (let i = 0; i < 15; i++) {
    await api('POST', '/api/ipam/prefixes/', { prefix: `172.${i}.0.0/16`, status: 'active', scope_type: 'dcim.site', scope_id: site.id });
  }
  db.queries = 0;
  const r = await api('GET', `/api/ipam/prefixes/?scope_id=${site.id}&limit=50`);
  assert.equal(r.body.count, 15);
  assert.ok(r.body.results.every((p) => p.scope && p.scope.display === 'DC3'));
  assert.ok(db.queries < 15, `expected batched queries, got ${db.queries}`);
  console.log(`  listed ${r.body.results.length} prefixes + scope in ${db.queries} queries`);
});
