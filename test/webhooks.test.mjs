// NetBox-style webhooks: fire HTTP requests on object create/update/delete,
// for core AND plugin entities, with object-type/event filtering + HMAC signing.
// Run: node --test test/webhooks.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { loadPlugins } from '../dist/plugins/runtime.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.wh.sqlite');
const SECRET = 'top-secret-key';
let db, server, base, recv, recvBase;
const got = {}; // path -> [{headers, raw, json}]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function waitFor(path, n) {
  for (let i = 0; i < 80; i++) {
    if ((got[path] || []).length >= n) return got[path];
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${n} delivery(ies) to ${path}`);
}

const demoPlugin = {
  name: 'demo',
  version: '0.1.0',
  entities: [
    {
      meta: {
        model: 'Thing',
        table: 'plugin_demo_thing',
        section: 'plugins',
        endpoint: '/api/plugins/demo/things/',
        origin: 'plugin',
        pk: 'id',
        objectType: 'plugins.thing',
        readOnly: false,
        relations: [],
        counts: [],
        columns: [
          {
            name: 'name',
            column: 'name',
            tsKind: 'string',
            nullable: false,
            writable: true,
            required: true,
            maxLength: 100,
          },
        ],
      },
    },
  ],
  migrations: [
    {
      version: '0001',
      sqlite:
        'CREATE TABLE plugin_demo_thing (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);',
      mariadb:
        'CREATE TABLE plugin_demo_thing (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL);',
    },
  ],
};

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
  db.exec(
    readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
  );
  db.exec(readFileSync(join(ROOT, 'migrations', '0010_webhook_template.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [demoPlugin]);

  // webhook receiver: records each request by URL path. /flaky fails the first hit.
  let flakyHits = 0;
  recv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      (got[req.url] ??= []).push({ headers: req.headers, raw, json: raw ? JSON.parse(raw) : null });
      if (req.url === '/flaky' && ++flakyHits === 1) {
        res.writeHead(500);
        res.end('boom');
      } else {
        res.writeHead(200);
        res.end('ok');
      }
    });
  });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  recvBase = `http://127.0.0.1:${recv.address().port}`;

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // configure webhooks via the API (deterministic object_types, not "*")
  await api('POST', '/api/extras/webhooks/', {
    name: 'man',
    payload_url: `${recvBase}/man`,
    secret: SECRET,
    object_types: ['dcim.manufacturer'],
    events: ['created', 'updated', 'deleted'],
  });
  await api('POST', '/api/extras/webhooks/', {
    name: 'sites',
    payload_url: `${recvBase}/sites`,
    object_types: ['dcim.site'],
    events: ['created'],
  });
  await api('POST', '/api/extras/webhooks/', {
    name: 'plug',
    payload_url: `${recvBase}/plug`,
    object_types: ['plugins.thing'],
    events: ['created'],
  });
  // conditions: only fire when slug == "match-me"
  await api('POST', '/api/extras/webhooks/', {
    name: 'cond',
    payload_url: `${recvBase}/cond`,
    object_types: ['dcim.manufacturer'],
    events: ['created'],
    conditions: { slug: 'match-me' },
  });
  // flaky endpoint to exercise retry/backoff
  await api('POST', '/api/extras/webhooks/', {
    name: 'flaky',
    payload_url: `${recvBase}/flaky`,
    object_types: ['ipam.rir'],
    events: ['created'],
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => recv.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('webhook is itself a CRUD resource (registered entity)', async () => {
  const list = await api('GET', '/api/extras/webhooks/');
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 5);
  assert.equal(list.body.results[0].object_types instanceof Array, true);
});

test('created/updated/deleted fire with NetBox-style payload + HMAC', async () => {
  const created = await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' });
  const id = created.body.id;

  const [c] = await waitFor('/man', 1);
  assert.equal(c.json.event, 'created');
  assert.equal(c.json.model, 'dcim.manufacturer');
  assert.equal(c.json.object_id, id);
  assert.equal(c.json.data.name, 'Acme');
  // HMAC-SHA512 of the exact body
  const expected = createHmac('sha512', SECRET).update(c.raw).digest('hex');
  assert.equal(c.headers['x-hook-signature'], expected);

  await api('PATCH', `/api/dcim/manufacturers/${id}/`, { description: 'edited' });
  const [, u] = await waitFor('/man', 2);
  assert.equal(u.json.event, 'updated');
  assert.equal(u.json.data.description, 'edited');

  await api('DELETE', `/api/dcim/manufacturers/${id}/`);
  const [, , d] = await waitFor('/man', 3);
  assert.equal(d.json.event, 'deleted');
  assert.equal(d.json.object_id, id);
  // delete payload carries the object's last state (NetBox-style), so templates
  // and conditions can reference {{ data.* }} on a delete
  assert.equal(d.json.data.name, 'Acme');
});

test('webhooks fire for plugin entities too', async () => {
  await api('POST', '/api/plugins/demo/things/', { name: 'widget-1' });
  const [t] = await waitFor('/plug', 1);
  assert.equal(t.json.event, 'created');
  assert.equal(t.json.model, 'plugins.thing');
  assert.equal(t.json.data.name, 'widget-1');
});

test('object-type filtering: non-matching webhook never fires', async () => {
  // we created/updated/deleted a manufacturer and a thing, but never a site
  await sleep(150);
  assert.equal((got['/sites'] || []).length, 0);
});

test('conditions: webhook fires only when object fields match', async () => {
  await api('POST', '/api/dcim/manufacturers/', { name: 'NoMatch', slug: 'nomatch' });
  await api('POST', '/api/dcim/manufacturers/', { name: 'Match', slug: 'match-me' });
  const [c] = await waitFor('/cond', 1);
  assert.equal(c.json.data.slug, 'match-me');
  await sleep(150);
  assert.equal((got['/cond'] || []).length, 1); // the "nomatch" create did not fire
});

test('failed delivery is retried with backoff', async () => {
  await api('POST', '/api/ipam/rirs/', { name: 'RIPE', slug: 'ripe' });
  // /flaky 500s once then 200s -> at least 2 attempts recorded at the receiver
  await waitFor('/flaky', 2);
  const deliveries = await api('GET', '/api/extras/webhook-deliveries/?ordering=-id');
  const flaky = deliveries.body.results.find((d) => d.webhook_name === 'flaky');
  assert.ok(flaky, 'flaky delivery logged');
  assert.equal(flaky.success, true);
  assert.ok(flaky.attempts >= 2, `attempts=${flaky.attempts}`);
});

test('delivery log is a read-only resource', async () => {
  const list = await api('GET', '/api/extras/webhook-deliveries/');
  assert.equal(list.status, 200);
  assert.ok(list.body.count >= 1);
  const r = list.body.results[0];
  assert.ok('success' in r && 'attempts' in r && 'payload_url' in r);
  const blocked = await api('POST', '/api/extras/webhook-deliveries/', { event: 'x' });
  assert.equal(blocked.status, 405); // read-only
});

test('disabled webhooks do not fire', async () => {
  // disable the manufacturer webhook, then create another manufacturer
  const list = await api('GET', '/api/extras/webhooks/');
  const man = list.body.results.find((w) => w.name === 'man');
  await api('PATCH', `/api/extras/webhooks/${man.id}/`, { enabled: false });
  const before = (got['/man'] || []).length;
  await api('POST', '/api/dcim/manufacturers/', { name: 'Beta', slug: 'beta' });
  await sleep(200);
  assert.equal((got['/man'] || []).length, before); // no new delivery
});
