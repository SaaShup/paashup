// NetBox -> paashup migration. A local server stands in for NetBox (token-authed,
// NetBox-shaped responses). Verifies the engine: dependency ordering, FK id remapping,
// self-reference resolution (region.parent), choice fields, and the UUID-pk device.
// Run: node --test test/netbox-migrate.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import netboxMigrate from '../dist/plugins/netbox-migrate/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.nbmigrate.sqlite');
let db, server, base, nb, nbBase;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = (results) => ({ count: results.length, next: null, previous: null, results });
// NetBox-shaped fixtures (regions deliberately out of order: child before parent).
const DATA = {
  '/api/dcim/regions/': page([
    { id: 2, name: 'FR', slug: 'fr', parent: { id: 1, name: 'EU' }, description: '' },
    { id: 1, name: 'EU', slug: 'eu', parent: null, description: 'Europe' },
  ]),
  '/api/dcim/manufacturers/': page([{ id: 5, name: 'Acme', slug: 'acme' }]),
  '/api/dcim/device-roles/': page([{ id: 7, name: 'Server', slug: 'server' }]),
  '/api/dcim/sites/': page([
    {
      id: 10,
      name: 'Paris',
      slug: 'paris',
      status: { value: 'active', label: 'Active' },
      region: { id: 2 },
    },
  ]),
  '/api/dcim/device-types/': page([{ id: 8, model: 'X1', slug: 'x1', manufacturer: { id: 5 } }]),
  '/api/dcim/devices/': page([
    {
      id: 20,
      name: 'srv1',
      status: { value: 'active', label: 'Active' },
      device_type: { id: 8 },
      role: { id: 7 },
      site: { id: 10 },
    },
  ]),
};

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

before(async () => {
  nb = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    res.setHeader('content-type', 'application/json');
    if (path === '/api/status/') return res.end(JSON.stringify({ 'netbox-version': '4.3.0' }));
    if (DATA[path]) return res.end(JSON.stringify(DATA[path]));
    res.end(JSON.stringify(page([]))); // unknown endpoint → empty
  });
  await new Promise((r) => nb.listen(0, '127.0.0.1', r));
  nbBase = `http://127.0.0.1:${nb.address().port}`;

  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [netboxMigrate]);
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => nb.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

const ONLY = [
  'dcim_region',
  'dcim_manufacturer',
  'dcim_device_role',
  'dcim_site',
  'dcim_device_type',
  'dcim_device',
];

test('run (wait) migrates the selected entities in dependency order with counts', async () => {
  const r = await api('POST', '/api/plugins/netbox-migrate/run/', {
    url: nbBase,
    token: 'fake-key',
    only: ONLY,
    wait: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.totals.total, 7); // counted from NetBox up front
  assert.equal(r.body.totals.created, 7); // 2 regions + mfr + role + site + type + device
  assert.equal(r.body.totals.failed, 0);
  assert.equal(r.body.progress.migrated, 7);
  assert.equal(r.body.progress.percent, 100); // migrated == total
  const regionReport = r.body.entities.find((e) => e.table === 'dcim_region');
  assert.equal(regionReport.total, 2);
  assert.equal(regionReport.linked, 1); // FR.parent resolved in the link pass
});

test('FK ids are remapped (self-ref, cross-entity) and choices/UUID handled', async () => {
  const regions = (await api('GET', '/api/dcim/regions/')).body.results;
  const eu = regions.find((x) => x.name === 'EU');
  const fr = regions.find((x) => x.name === 'FR');
  assert.ok(eu && fr);
  assert.equal(fr.parent.id, eu.id); // self-reference remapped to the new id

  const site = (await api('GET', '/api/dcim/sites/')).body.results[0];
  assert.equal(site.name, 'Paris');
  assert.equal(site.region.id, fr.id); // cross-entity FK remapped
  assert.equal(site.status.value, 'active'); // choice migrated

  const dtype = (await api('GET', '/api/dcim/device-types/')).body.results[0];
  const mfr = (await api('GET', '/api/dcim/manufacturers/')).body.results[0];
  assert.equal(dtype.manufacturer.id, mfr.id); // required FK remapped

  const dev = (await api('GET', '/api/dcim/devices/')).body.results[0];
  assert.equal(dev.name, 'srv1');
  assert.match(String(dev.id), /^[0-9a-f-]{36}$/); // device got a fresh UUID, not NetBox id 20
  assert.equal(dev.device_type.id, dtype.id);
  assert.equal(dev.site.id, site.id);
  assert.equal(dev.role.id, (await api('GET', '/api/dcim/device-roles/')).body.results[0].id);
});

test('a background run exposes a live progress counter (migrated vs total)', async () => {
  // dry_run so this second run does not collide with the rows created above
  const start = await api('POST', '/api/plugins/netbox-migrate/run/', {
    url: nbBase,
    token: 'fake-key',
    only: ONLY,
    dry_run: true,
  });
  assert.equal(start.status, 202, JSON.stringify(start.body)); // started in the background

  let prog;
  for (let i = 0; i < 100; i++) {
    prog = (await api('GET', '/api/plugins/netbox-migrate/progress/')).body;
    if (prog.done) break;
    await sleep(20);
  }
  assert.equal(prog.done, true);
  assert.equal(prog.total, 7); // counted up front
  assert.equal(prog.migrated, 7); // climbed to the total
  assert.equal(prog.percent, 100);
  assert.equal(prog.result.totals.total, 7);
});

test('missing url/token is a 400; bad NetBox host is a 502', async () => {
  assert.equal(
    (await api('POST', '/api/plugins/netbox-migrate/run/', { url: nbBase })).status,
    400,
  );
  const bad = await api('POST', '/api/plugins/netbox-migrate/run/', {
    url: 'http://127.0.0.1:1/',
    token: 'x',
  });
  assert.equal(bad.status, 502);
});

// Regression: a required FK (e.g. VMInterface.virtual_machine) must be created before
// its dependent, even across NetBox's full-core FK cycles (issue: vminterface failed
// "Validation failed" because it was ordered before virtual_machine).
test('orderedEntities places required-FK targets before dependents', async () => {
  const { orderedEntities } = await import('../dist/plugins/netbox-migrate/migrate.js');
  const order = orderedEntities().map((m) => m.table);
  const idx = (t) => order.indexOf(t);
  for (const t of [
    'virtualization_cluster',
    'virtualization_virtual_machine',
    'virtualization_vminterface',
  ]) {
    assert.ok(idx(t) >= 0, `${t} missing from order`);
  }
  assert.ok(
    idx('virtualization_virtual_machine') < idx('virtualization_vminterface'),
    'virtual_machine must come before vminterface (required FK)',
  );
  assert.ok(idx('virtualization_cluster') < idx('virtualization_virtual_machine'));
});
