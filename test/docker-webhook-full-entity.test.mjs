// Regression: Docker webhook payloads must carry the FULL nested entity (like GET /
// NetBox) on EVERY write path — including bulk collection updates and the entities whose
// writes go through generic CRUD (image/registry/…). Previously bulk/generic writes used
// the generic serializer and dropped nested children (a container's ports/env/mounts, a
// registry's images, …), so the Docker agent received an incomplete object to act on.
// Run: PB_WEBHOOK_BACKOFF_MS=30 node --test test/docker-webhook-full-entity.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import dockerPlugin from '../dist/plugins/docker/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.docker-wh-full.sqlite');
const NESTED = [
  'ports',
  'env',
  'binds',
  'mounts',
  'network_settings',
  'devices',
  'labels',
  'log_driver_options',
  'sysctls',
];
let db, server, base, recv, recvBase, hostId, regId, imageId, containerId;
const got = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** Wait for the webhook delivery matching `pred` (over the full body), return its `data`.
 *  Matching the exact event avoids picking up an in-flight delivery from setup. */
async function waitData(pred) {
  for (let i = 0; i < 100; i++) {
    const hit = got.find(pred);
    if (hit) return hit.data;
    await sleep(20);
  }
  throw new Error('no matching webhook delivery');
}

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
  db.exec(
    readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
  );
  db.exec(readFileSync(join(ROOT, 'migrations', '0010_webhook_template.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin]);

  recv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      got.push(raw ? JSON.parse(raw) : {});
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  recvBase = `http://127.0.0.1:${recv.address().port}`;

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await api('POST', '/api/extras/webhooks/', {
    name: 'agent',
    payload_url: `${recvBase}/all`,
    object_types: ['*'],
    events: ['created', 'updated', 'deleted'],
  });
  hostId = (await api('POST', '/api/plugins/docker/hosts/', { endpoint: 'http://a:1', name: 'h' }))
    .body.id;
  regId = (
    await api('POST', '/api/plugins/docker/registries/', {
      host: hostId,
      name: 'r',
      serveraddress: 'https://x/v2/',
    })
  ).body.id;
  imageId = (
    await api('POST', '/api/plugins/docker/images/', { host: hostId, registry: regId, name: 'img' })
  ).body.id;
  containerId = (
    await api('POST', '/api/plugins/docker/containers/', {
      host: hostId,
      image: imageId,
      name: 'c1',
    })
  ).body.id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => recv.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('bulk container update webhook carries the full nested entity (ports/env/mounts/…)', async () => {
  got.length = 0;
  const r = await api('PATCH', '/api/plugins/docker/containers/', [
    { id: containerId, operation: 'recreate' },
  ]);
  assert.equal(r.status, 200);
  const data = await waitData(
    (g) => g.event === 'updated' && g.data?.id === containerId && g.data?.operation === 'recreate',
  );
  for (const key of NESTED) assert.ok(key in data, `bulk webhook missing nested "${key}"`);
  assert.equal(data.name, 'c1'); // scalars still present
});

test('container POST webhook carries the full nested entity', async () => {
  got.length = 0;
  const c = await api('POST', '/api/plugins/docker/containers/', {
    host: hostId,
    image: imageId,
    name: 'c2',
  });
  const data = await waitData((g) => g.event === 'created' && g.data?.id === c.body.id);
  for (const key of NESTED) assert.ok(key in data, `create webhook missing nested "${key}"`);
});

test('generic-path entities embed their nested arrays on write (image, registry)', async () => {
  got.length = 0;
  await api('PATCH', `/api/plugins/docker/images/${imageId}/`, { version: '2' });
  const img = await waitData((g) => g.event === 'updated' && g.data?.id === imageId);
  assert.ok('containers' in img, 'image webhook missing nested "containers"');

  got.length = 0;
  await api('PATCH', '/api/plugins/docker/registries/', [{ id: regId, username: 'u' }]);
  const reg = await waitData((g) => g.event === 'updated' && g.data?.id === regId);
  assert.ok('images' in reg, 'registry bulk webhook missing nested "images"');
});
