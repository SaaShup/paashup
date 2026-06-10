// Core "config context" feature (NetBox-compatible). Verifies:
//   - CRUD on /api/extras/config-contexts/ (incl. JSON `data` + criteria arrays)
//   - the rendered context merges applicable contexts in (weight, name) order
//   - assignment criteria actually scope which contexts apply (region/role match)
//   - inactive contexts and non-matching criteria are excluded
// Run: node --test test/configcontext.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.configcontext.sqlite');
let db, server, base;

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** Remove all config contexts so a render test starts from a known-empty set. */
async function clearContexts() {
  const list = await api('GET', '/api/extras/config-contexts/?limit=1000');
  for (const c of list.body.results ?? []) {
    await api('DELETE', `/api/extras/config-contexts/${c.id}/`);
  }
}

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0009_configcontext.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('config contexts: create, list, read JSON data back', async () => {
  const r = await api('POST', '/api/extras/config-contexts/', {
    name: 'base-dns',
    weight: 1000,
    data: { dns: { servers: ['8.8.8.8'] }, ntp: 'pool.ntp.org' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.name, 'base-dns');
  assert.deepEqual(r.body.data, { dns: { servers: ['8.8.8.8'] }, ntp: 'pool.ntp.org' });
  assert.equal(r.body.is_active, true); // DB default
  assert.deepEqual(r.body.regions, []); // criteria default to []

  const list = await api('GET', '/api/extras/config-contexts/');
  assert.equal(list.status, 200);
  assert.ok(list.body.count >= 1);
});

test('rendered context deep-merges applicable contexts by (weight, name)', async () => {
  await clearContexts(); // independent of other tests' contexts
  // a device to render against: region -> site -> device(type, role)
  const region = (await api('POST', '/api/dcim/regions/', { name: 'CC-EU', slug: 'cc-eu' })).body;
  const site = (
    await api('POST', '/api/dcim/sites/', {
      name: 'CC-Site',
      slug: 'cc-site',
      status: 'active',
      region: region.id,
    })
  ).body;
  const mfr = (await api('POST', '/api/dcim/manufacturers/', { name: 'CC-M', slug: 'cc-m' })).body;
  const dtype = (
    await api('POST', '/api/dcim/device-types/', { manufacturer: mfr.id, model: 'CC-T', slug: 'cc-t' })
  ).body;
  const role = (
    await api('POST', '/api/dcim/device-roles/', { name: 'CC-Role', slug: 'cc-role' })
  ).body;
  const dev = (
    await api('POST', '/api/dcim/devices/', {
      name: 'cc-dev',
      device_type: dtype.id,
      role: role.id,
      site: site.id,
      status: 'active',
    })
  ).body;
  assert.ok(dev.id, JSON.stringify(dev));

  // global low-weight base (no criteria => applies to everything)
  await api('POST', '/api/extras/config-contexts/', {
    name: 'global',
    weight: 500,
    data: { dns: { servers: ['1.1.1.1'] }, role: 'default' },
  });
  // region-scoped, higher weight => overrides on conflicts, merges nested
  await api('POST', '/api/extras/config-contexts/', {
    name: 'region-eu',
    weight: 1500,
    regions: [region.id],
    data: { dns: { search: 'eu.example' }, role: 'eu' },
  });
  // a context for a DIFFERENT region => must NOT apply
  const other = (await api('POST', '/api/dcim/regions/', { name: 'CC-US', slug: 'cc-us' })).body;
  await api('POST', '/api/extras/config-contexts/', {
    name: 'region-us',
    weight: 9999,
    regions: [other.id],
    data: { role: 'us-should-not-win' },
  });
  // inactive context that would otherwise match => excluded
  await api('POST', '/api/extras/config-contexts/', {
    name: 'inactive',
    weight: 9999,
    is_active: false,
    roles: [role.id],
    data: { role: 'inactive-should-not-win' },
  });

  const r = await api('GET', `/api/extras/config-contexts/render/?device=${dev.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // higher-weight region context wins on `role`; nested `dns` is deep-merged
  assert.equal(r.body.config_context.role, 'eu');
  assert.deepEqual(r.body.config_context.dns, { servers: ['1.1.1.1'], search: 'eu.example' });
  const names = r.body.applied.map((a) => a.name);
  assert.deepEqual(names, ['global', 'region-eu']); // sorted by weight, scoped correctly
});

test('role criterion scopes a context to matching devices only', async () => {
  await clearContexts();
  // device with no role should not receive a role-scoped context
  const site = (
    await api('POST', '/api/dcim/sites/', { name: 'CC-S2', slug: 'cc-s2', status: 'active' })
  ).body;
  const mfr = (await api('POST', '/api/dcim/manufacturers/', { name: 'CC-M2', slug: 'cc-m2' })).body;
  const dtype = (
    await api('POST', '/api/dcim/device-types/', { manufacturer: mfr.id, model: 'CC-T2', slug: 'cc-t2' })
  ).body;
  const role = (await api('POST', '/api/dcim/device-roles/', { name: 'CC-R2', slug: 'cc-r2' })).body;
  const dev = (
    await api('POST', '/api/dcim/devices/', {
      name: 'cc-dev2',
      device_type: dtype.id,
      site: site.id,
      status: 'active',
    })
  ).body; // no role

  await api('POST', '/api/extras/config-contexts/', {
    name: 'role-only',
    weight: 100,
    roles: [role.id],
    data: { tier: 'special' },
  });
  const r = await api('GET', `/api/extras/config-contexts/render/?device=${dev.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!r.body.applied.some((a) => a.name === 'role-only'), 'role-scoped context wrongly applied');
});

test('render requires a target and 404s on unknown device', async () => {
  assert.equal((await api('GET', '/api/extras/config-contexts/render/')).status, 400);
  const r = await api('GET', '/api/extras/config-contexts/render/?device=does-not-exist');
  assert.equal(r.status, 404);
});

test('config context data + criteria can be updated', async () => {
  const c = (
    await api('POST', '/api/extras/config-contexts/', { name: 'upd', data: { a: 1 } })
  ).body;
  const u = await api('PATCH', `/api/extras/config-contexts/${c.id}/`, {
    data: { a: 2, b: 3 },
    weight: 42,
  });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.deepEqual(u.body.data, { a: 2, b: 3 });
  assert.equal(u.body.weight, 42);
});
