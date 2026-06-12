// Docker plugin features are driven by webhooks: a Docker object CRUD'd in paasbox
// fires a webhook that the external Docker agent consumes to perform the real
// operation. Per feature this verifies:
//   - TRUE POSITIVE : the change fires the correct webhook (agent receives it).
//   - FALSE NEGATIVE: no lifecycle event is silently missed (update + delete fire).
//   - guard: a webhook scoped to another type does NOT fire (no false positive).
// Run: PB_WEBHOOK_BACKOFF_MS=50 node --test test/docker-webhooks.test.mjs
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
const DB = join(ROOT, 'test', '.docker-wh.sqlite');
let db, server, base, recv, recvBase, hostId, registryId, imageId;
const got = { all: [], img: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** Wait until `bucket` holds a delivery matching `pred` (else throw — a false negative). */
async function waitFor(bucket, pred, label) {
  for (let i = 0; i < 100; i++) {
    const hit = got[bucket].find(pred);
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error(`webhook never fired: ${label}`);
}
const fired = (bucket, pred) => got[bucket].some(pred);

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
  db.exec(
    readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
  );
  db.exec(readFileSync(join(ROOT, 'migrations', '0010_webhook_template.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin]); // creates plugin_docker_* tables + registers entities

  recv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      got[req.url === '/img' ? 'img' : 'all'].push(raw ? JSON.parse(raw) : {});
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  recvBase = `http://127.0.0.1:${recv.address().port}`;

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // catch-all webhook (stands in for the agent's feed) + an image-scoped one
  await api('POST', '/api/extras/webhooks/', {
    name: 'agent',
    payload_url: `${recvBase}/all`,
    object_types: ['*'],
    events: ['created', 'updated', 'deleted'],
  });
  await api('POST', '/api/extras/webhooks/', {
    name: 'img',
    payload_url: `${recvBase}/img`,
    object_types: ['plugins.dockerimage'],
    events: ['created'],
  });

  // shared fixtures for dependent features
  hostId = (
    await api('POST', '/api/plugins/docker/hosts/', {
      endpoint: 'http://agent:8080',
      name: 'base-host',
    })
  ).body.id;
  registryId = (
    await api('POST', '/api/plugins/docker/registries/', {
      host: hostId,
      name: 'base-reg',
      serveraddress: 'https://r.example/v2/',
    })
  ).body.id;
  imageId = (
    await api('POST', '/api/plugins/docker/images/', {
      host: hostId,
      registry: registryId,
      name: 'base-img',
    })
  ).body.id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => recv.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

// per-feature create payloads (unique name => unambiguous delivery matching)
const features = () => [
  {
    model: 'plugins.dockerhost',
    ep: '/api/plugins/docker/hosts/',
    make: (n) => ({ endpoint: 'http://a:1', name: n }),
  },
  {
    model: 'plugins.dockerregistry',
    ep: '/api/plugins/docker/registries/',
    make: (n) => ({ host: hostId, name: n, serveraddress: 'https://x/v2/' }),
  },
  {
    model: 'plugins.dockerimage',
    ep: '/api/plugins/docker/images/',
    make: (n) => ({ host: hostId, registry: registryId, name: n }),
  },
  {
    model: 'plugins.dockervolume',
    ep: '/api/plugins/docker/volumes/',
    make: (n) => ({ host: hostId, name: n }),
  },
  {
    model: 'plugins.dockernetwork',
    ep: '/api/plugins/docker/networks/',
    make: (n) => ({ host: hostId, name: n }),
  },
  {
    model: 'plugins.dockercontainer',
    ep: '/api/plugins/docker/containers/',
    make: (n) => ({ host: hostId, image: imageId, name: n }),
  },
];

for (const f of features()) {
  const short = f.model.replace('plugins.docker', '');

  test(`TRUE POSITIVE — creating a ${short} fires its webhook with correct payload`, async () => {
    const name = `${short}-tp`;
    const r = await api('POST', f.ep, f.make(name));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const d = await waitFor(
      'all',
      (x) => x.model === f.model && x.event === 'created' && x.data?.name === name,
      `${short} created`,
    );
    assert.equal(d.object_id, r.body.id);
  });

  test(`FALSE NEGATIVE — ${short} update & delete are not missed`, async () => {
    const id = (await api('POST', f.ep, f.make(`${short}-fn`))).body.id;
    await api('PATCH', `${f.ep}${id}/`, { name: `${short}-fn2` });
    await waitFor(
      'all',
      (x) => x.model === f.model && x.event === 'updated' && x.object_id === id,
      `${short} updated`,
    );
    await api('DELETE', `${f.ep}${id}/`);
    await waitFor(
      'all',
      (x) => x.model === f.model && x.event === 'deleted' && x.object_id === id,
      `${short} deleted`,
    );
  });
}

test('FEATURE — creating a host seeds a default "dockerhub" registry', async () => {
  const h = await api('POST', '/api/plugins/docker/hosts/', {
    endpoint: 'http://seed:1',
    name: 'seed-host',
  });
  const regs = await api('GET', `/api/plugins/docker/registries/?host=${h.body.id}`);
  assert.ok(
    regs.body.results.some((reg) => reg.name === 'dockerhub'),
    'default dockerhub registry not seeded',
  );
});

test('webhook payload — image data.host brief includes endpoint (for payload_url templating)', async () => {
  got.img.length = 0;
  await api('POST', '/api/plugins/docker/images/', {
    host: hostId,
    registry: registryId,
    name: 'img-endpoint',
  });
  const d = await waitFor(
    'img',
    (x) => x.model === 'plugins.dockerimage' && x.data?.name === 'img-endpoint',
    'image fired',
  );
  // {{ data.host.endpoint }} relies on the host brief carrying `endpoint`
  assert.equal(d.data.host.endpoint, 'http://agent:8080');
});

test('webhook payload — deleted host carries data.endpoint (for payload_url templating)', async () => {
  const ep = 'http://agent-del:8080';
  const id = (await api('POST', '/api/plugins/docker/hosts/', { endpoint: ep, name: 'del-host' }))
    .body.id;
  await api('DELETE', `/api/plugins/docker/hosts/${id}/`);
  const d = await waitFor(
    'all',
    (x) => x.model === 'plugins.dockerhost' && x.event === 'deleted' && x.object_id === id,
    'host deleted',
  );
  // {{ data.endpoint }} on a delete relies on the payload carrying the last state
  assert.equal(d.data.endpoint, ep);
});

test('guard — image-scoped webhook ignores non-image changes (no false positive)', async () => {
  got.img.length = 0;
  await api('POST', '/api/plugins/docker/volumes/', { host: hostId, name: 'vol-x' });
  await api('POST', '/api/plugins/docker/images/', {
    host: hostId,
    registry: registryId,
    name: 'img-x',
  });
  await waitFor(
    'img',
    (x) => x.model === 'plugins.dockerimage' && x.data?.name === 'img-x',
    'image fired',
  );
  await sleep(150);
  assert.ok(
    !fired('img', (x) => x.model === 'plugins.dockervolume'),
    'image webhook wrongly fired for a volume',
  );
});
