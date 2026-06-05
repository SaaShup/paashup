// Tagging + M2M attach API, end-to-end over HTTP against SQLite.
// Run: node --test test/relations.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.rel.sqlite');

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
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('tags auto-create by name and serialize as briefs', async () => {
  const created = await api('POST', '/api/dcim/manufacturers/', {
    name: 'Acme',
    slug: 'acme',
    tags: [{ name: 'Core' }, { name: 'Edge' }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.tags.length, 2);
  const names = created.body.tags.map((t) => t.display).sort();
  assert.deepEqual(names, ['Core', 'Edge']);
  assert.ok(created.body.tags[0].url.includes('/api/extras/tags/'));

  // the tags were actually created in extras_tag
  const tagList = await api('GET', '/api/extras/tags/?q=Core');
  assert.ok(tagList.body.count >= 1);
});

test('tags can be attached by existing id and slug, and replaced', async () => {
  const t1 = (await api('POST', '/api/extras/tags/', { name: 'Prod', slug: 'prod' })).body;
  const m = (
    await api('POST', '/api/dcim/manufacturers/', { name: 'Beta', slug: 'beta', tags: [t1.id] })
  ).body;
  assert.deepEqual(
    m.tags.map((t) => t.id),
    [t1.id],
  );

  // PATCH replaces the whole set (NetBox semantics)
  const t2 = (await api('POST', '/api/extras/tags/', { name: 'Stage', slug: 'stage' })).body;
  const patched = await api('PATCH', `/api/dcim/manufacturers/${m.id}/`, {
    tags: [{ slug: 'stage' }],
  });
  assert.deepEqual(
    patched.body.tags.map((t) => t.id),
    [t2.id],
  );

  // clearing with []
  const cleared = await api('PATCH', `/api/dcim/manufacturers/${m.id}/`, { tags: [] });
  assert.deepEqual(cleared.body.tags, []);
});

test('PATCH without tags leaves them untouched', async () => {
  const m = (
    await api('POST', '/api/dcim/manufacturers/', {
      name: 'Gamma',
      slug: 'gamma',
      tags: [{ name: 'Keep' }],
    })
  ).body;
  const patched = await api('PATCH', `/api/dcim/manufacturers/${m.id}/`, { description: 'x' });
  assert.equal(patched.body.tags.length, 1);
  assert.equal(patched.body.tags[0].display, 'Keep');
});

test('generic M2M attach (VRF.import_targets) with briefs', async () => {
  const rtA = (await api('POST', '/api/ipam/route-targets/', { name: '65000:1' })).body;
  const rtB = (await api('POST', '/api/ipam/route-targets/', { name: '65000:2' })).body;
  const vrf = (
    await api('POST', '/api/ipam/vrfs/', { name: 'blue', import_targets: [rtA.id, rtB.id] })
  ).body;
  assert.equal(vrf.import_targets.length, 2);
  assert.deepEqual(vrf.import_targets.map((r) => r.display).sort(), ['65000:1', '65000:2']);
  assert.deepEqual(vrf.export_targets, []);

  const got = await api('GET', `/api/ipam/vrfs/${vrf.id}/`);
  assert.equal(got.body.import_targets.length, 2);
});

test('bidirectional M2M: ASN.sites and Site.asns share one table', async () => {
  const site = (
    await api('POST', '/api/dcim/sites/', { name: 'DC9', slug: 'dc9', status: 'active' })
  ).body;
  const asn = (await api('POST', '/api/ipam/asns/', { asn: 64512, rir: null, sites: [site.id] }))
    .body;
  assert.deepEqual(
    asn.sites.map((s) => s.id),
    [site.id],
  );

  // reading from the reverse side reflects the same link
  const siteGot = await api('GET', `/api/dcim/sites/${site.id}/`);
  assert.deepEqual(
    siteGot.body.asns.map((a) => a.id),
    [asn.id],
  );
});

test('invalid relation input is rejected', async () => {
  const badArr = await api('POST', '/api/dcim/manufacturers/', {
    name: 'E1',
    slug: 'e1',
    tags: 'nope',
  });
  assert.equal(badArr.status, 400);

  const missingRt = await api('POST', '/api/ipam/vrfs/', {
    name: 'red',
    import_targets: [{ slug: 'does-not-exist' }],
  });
  assert.equal(missingRt.status, 400);
});

test('list endpoint serializes relations in bounded queries', async () => {
  for (let i = 0; i < 20; i++) {
    await api('POST', '/api/ipam/roles/', {
      name: `R${i}`,
      slug: `r${i}`,
      tags: [{ name: 'Shared' }],
    });
  }
  db.queries = 0;
  const r = await api('GET', '/api/ipam/roles/?limit=50');
  assert.ok(r.body.count >= 20);
  assert.ok(r.body.results.every((x) => Array.isArray(x.tags)));
  // tags batched: a few queries for the whole page, not per-row.
  assert.ok(db.queries < 15, `expected few queries, got ${db.queries}`);
  console.log(`  listed ${r.body.results.length} roles + tags in ${db.queries} queries`);
});
