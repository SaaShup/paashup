// NetBox-style webhook templating: payload_url, additional_headers and body_template
// are rendered with the event context — {{ event }} {{ model }} {{ timestamp }}
// {{ username }} {{ request_id }} {{ data.* }} {{ snapshots.prechange.* }}.
// Run: node --test test/webhook-templates.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { createToken } from '../dist/auth.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.wh-tmpl.sqlite');
const MIGRATIONS = [
  '0002_auth_token',
  '0003_webhook',
  '0004_webhook_conditions_delivery',
  '0010_webhook_template',
];
let db, server, base, recv, recvBase, token;
const recvd = []; // { url, headers, json }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (m, p, b, headers = {}) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: { ...(b ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function waitFor(pred, label) {
  for (let i = 0; i < 120; i++) {
    const hit = recvd.find(pred);
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error(`webhook never arrived: ${label}`);
}

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  for (const m of MIGRATIONS)
    db.exec(readFileSync(join(ROOT, 'migrations', `${m}.sqlite.sql`), 'utf8'));

  recv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let json = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        /* non-JSON body */
      }
      recvd.push({ url: req.url, headers: req.headers, json });
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  recvBase = `http://127.0.0.1:${recv.address().port}`;

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // a user + token so we can exercise {{ username }} / {{ request_id }}
  const u = await db.execute('INSERT INTO users_user (username) VALUES (?)', ['wally']);
  token = (await createToken(db, { userId: u.insertId })).key;

  // 1) URL template — per-object endpoint
  await api('POST', '/api/extras/webhooks/', {
    name: 'url-tmpl',
    payload_url: `${recvBase}/sync/{{ data.slug }}?model={{ model }}`,
    object_types: ['dcim.manufacturer'],
    events: ['created'],
  });
  // 2) body template — incl. a prechange snapshot with a default filter
  await api('POST', '/api/extras/webhooks/', {
    name: 'body-tmpl',
    payload_url: `${recvBase}/body`,
    object_types: ['dcim.manufacturer'],
    events: ['created', 'updated'],
    body_template:
      '{"name":"{{ data.name }}","event":"{{ event }}","pre":"{{ snapshots.prechange.description | default(\'none\') }}"}',
  });
  // 3) header template
  await api('POST', '/api/extras/webhooks/', {
    name: 'hdr-tmpl',
    payload_url: `${recvBase}/hdr`,
    object_types: ['dcim.manufacturer'],
    events: ['created'],
    additional_headers: 'X-Object: {{ data.slug }}\nX-Event: {{ event }}',
  });
  // 4) username + request_id (needs an authenticated request)
  await api('POST', '/api/extras/webhooks/', {
    name: 'auth-tmpl',
    payload_url: `${recvBase}/auth`,
    object_types: ['dcim.manufacturer'],
    events: ['created'],
    body_template: '{"user":"{{ username }}","rid":"{{ request_id }}","slug":"{{ data.slug }}"}',
  });
  // 5) filters (urlencode/lower/upper) + snapshots.postchange
  await api('POST', '/api/extras/webhooks/', {
    name: 'filter-tmpl',
    payload_url: `${recvBase}/f?name={{ data.name | urlencode }}`,
    object_types: ['dcim.manufacturer'],
    events: ['created'],
    additional_headers: 'X-Lower: {{ data.name | lower }}\nX-Upper: {{ data.name | upper }}',
    body_template: '{"post":"{{ snapshots.postchange.slug }}","slug":"{{ data.slug }}"}',
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => recv.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('payload_url is rendered with the event context', async () => {
  await api('POST', '/api/dcim/manufacturers/', { name: 'Tmpl', slug: 'tmpl-co' });
  const hit = await waitFor((r) => r.url.startsWith('/sync/tmpl-co'), 'url-template');
  assert.equal(hit.url, '/sync/tmpl-co?model=dcim.manufacturer');
});

test('body_template renders data, event, and snapshots.prechange (with default filter)', async () => {
  const created = await api('POST', '/api/dcim/manufacturers/', {
    name: 'BodyCo',
    slug: 'body-co',
    description: 'orig',
  });
  // created: prechange is null -> default('none')
  const c = await waitFor(
    (r) => r.url === '/body' && r.json?.event === 'created' && r.json?.name === 'BodyCo',
    'body created',
  );
  assert.equal(c.json.pre, 'none');

  // updated: prechange carries the previous description
  await api('PATCH', `/api/dcim/manufacturers/${created.body.id}/`, { description: 'changed' });
  const u = await waitFor(
    (r) => r.url === '/body' && r.json?.event === 'updated' && r.json?.name === 'BodyCo',
    'body updated',
  );
  assert.equal(u.json.pre, 'orig');
});

test('additional_headers values are rendered', async () => {
  await api('POST', '/api/dcim/manufacturers/', { name: 'Hdr', slug: 'hdr-co' });
  const hit = await waitFor(
    (r) => r.url === '/hdr' && r.json?.data?.slug === 'hdr-co',
    'header-tmpl',
  );
  assert.equal(hit.headers['x-object'], 'hdr-co');
  assert.equal(hit.headers['x-event'], 'created');
});

test('username and request_id come from the triggering request', async () => {
  await api(
    'POST',
    '/api/dcim/manufacturers/',
    { name: 'Auth', slug: 'auth-co' },
    { Authorization: `Token ${token}` },
  );
  const hit = await waitFor((r) => r.url === '/auth' && r.json?.slug === 'auth-co', 'auth-tmpl');
  assert.equal(hit.json.user, 'wally');
  assert.match(hit.json.rid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('filters (urlencode/lower/upper) and snapshots.postchange render', async () => {
  await api('POST', '/api/dcim/manufacturers/', { name: 'Filter Co', slug: 'filter-co' });
  const hit = await waitFor(
    (r) => r.url.startsWith('/f?') && r.json?.slug === 'filter-co',
    'filter',
  );
  // urlencode: "Filter Co" -> "Filter%20Co" in the URL
  assert.equal(hit.url, '/f?name=Filter%20Co');
  // lower / upper in headers
  assert.equal(hit.headers['x-lower'], 'filter co');
  assert.equal(hit.headers['x-upper'], 'FILTER CO');
  // postchange snapshot (the object after the change)
  assert.equal(hit.json.post, 'filter-co');
});
