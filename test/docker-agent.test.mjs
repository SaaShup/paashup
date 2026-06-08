// End-to-end with a Docker AGENT in the loop. There is no real dockerd here; the
// stub agent stands in for SaaShup/netbox-docker-agent and models a fake engine:
//   paasbox  --(webhook: container created)-->  agent  --(provision in fake engine)
//           <--(callback: PATCH ContainerID)--  agent
// It also serves the /api/engine/* endpoints paasbox proxies (force_pull).
// Run: PB_WEBHOOK_BACKOFF_MS=50 node --test test/docker-agent.test.mjs
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
const DB = join(ROOT, 'test', '.docker-agent.sqlite');
let db, server, base, agent, agentBase, paasboxBase;
let hostId, registryId, imageId;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fake engine + observability for the stub agent
const engine = { containers: new Map(), pulls: [] };
const received = []; // webhooks the agent got

const api = (b, m, p, body) =>
  fetch(`${b}${p}`, {
    method: m,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const pb = (m, p, b) => api(base, m, p, b);

// ---- the stub Docker agent ----
function startAgent() {
  agent = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      void (async () => {
        const body = raw ? JSON.parse(raw) : {};
        // 1) webhook ingest: provision containers in the fake engine, then call back
        if (req.url === '/webhook') {
          received.push(body);
          if (body.model === 'plugins.dockercontainer' && body.event === 'created') {
            const cid = `cid-${body.object_id}`;
            engine.containers.set(cid, body.data?.name); // "docker run"
            // report state back to paasbox (like the real agent updates the record)
            await api(paasboxBase, 'PATCH', `/api/plugins/docker/containers/${body.object_id}/`, {
              ContainerID: cid,
            });
          }
          res.writeHead(200);
          return res.end('ok');
        }
        // 2) engine proxy endpoints paasbox calls for actions
        if (req.url === '/api/engine/images') {
          engine.pulls.push(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ pulled: true }));
        }
        res.writeHead(404);
        res.end('nope');
      })();
    });
  });
  return new Promise((r) => agent.listen(0, '127.0.0.1', () => r()));
}

before(async () => {
  await startAgent();
  agentBase = `http://127.0.0.1:${agent.address().port}`;

  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
  db.exec(
    readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
  );
  await loadPlugins(db, [dockerPlugin]);
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  paasboxBase = base;

  // wire the agent's webhook feed: container created -> agent
  await pb('POST', '/api/extras/webhooks/', {
    name: 'docker-agent',
    payload_url: `${agentBase}/webhook`,
    object_types: ['plugins.dockercontainer'],
    events: ['created'],
  });

  hostId = (
    await pb('POST', '/api/plugins/docker/hosts/', { endpoint: agentBase, name: 'agent-host' })
  ).body.id;
  registryId = (
    await pb('POST', '/api/plugins/docker/registries/', {
      host: hostId,
      name: 'reg',
      serveraddress: 'https://r/v2/',
    })
  ).body.id;
  imageId = (
    await pb('POST', '/api/plugins/docker/images/', {
      host: hostId,
      registry: registryId,
      name: 'nginx',
    })
  ).body.id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => agent.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('creating a container reaches the agent via webhook, which provisions it and calls back', async () => {
  const r = await pb('POST', '/api/plugins/docker/containers/', {
    host: hostId,
    image: imageId,
    name: 'web',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;

  // the agent receives the webhook and provisions the container in its (fake) engine
  let got;
  for (let i = 0; i < 100; i++) {
    got = await pb('GET', `/api/plugins/docker/containers/${id}/`);
    if (got.body.ContainerID) break;
    await sleep(25);
  }
  assert.equal(got.body.ContainerID, `cid-${id}`, 'agent did not call back to set ContainerID');
  assert.ok(
    received.some((w) => w.model === 'plugins.dockercontainer' && w.object_id === id),
    'agent never received the container webhook',
  );
  assert.equal(
    engine.containers.get(`cid-${id}`),
    'web',
    'container not provisioned in the engine',
  );
});

test('force_pull is proxied through to the agent engine', async () => {
  const pull = await pb('POST', `/api/plugins/docker/images/${imageId}/force_pull/`);
  assert.equal(pull.status, 200, JSON.stringify(pull.body));
  assert.deepEqual(pull.body, { success: true, payload: { pulled: true } });
  assert.ok(engine.pulls.length >= 1, 'agent engine never received the pull');
});
