// WebSocket change-feed: API writes broadcast created/updated/deleted to clients.
// Run: node --test test/realtime.test.mjs   (uses Node's global WebSocket client)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { createToken } from '../dist/auth.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.rt.sqlite');
let db, server, base, wsUrl;

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** Open a WS, collect messages, and expose a waiter for the next matching one. */
function connect(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const w = waiters.find((x) => x.match(msg));
    if (w) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(msg);
    } else queue.push(msg);
  });
  const ready = new Promise((res) => ws.addEventListener('open', () => res()));
  const next = (match) =>
    new Promise((resolve, reject) => {
      const found = queue.find(match);
      if (found) {
        queue.splice(queue.indexOf(found), 1);
        return resolve(found);
      }
      const t = setTimeout(() => reject(new Error('ws message timeout')), 3000);
      waiters.push({ match, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  return { ws, ready, next };
}

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db, realtime: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/api/ws/`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('client receives a hello on connect', async () => {
  const c = connect(wsUrl);
  await c.ready;
  const hello = await c.next((m) => m.type === 'hello');
  assert.ok(typeof hello.ts === 'number');
  c.ws.close();
});

test('create/update/delete are broadcast with object_type + data', async () => {
  const c = connect(wsUrl);
  await c.ready;

  const created = await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' });
  const cEvt = await c.next((m) => m.type === 'change' && m.event === 'created');
  assert.equal(cEvt.object_type, 'dcim.manufacturer');
  assert.equal(cEvt.table, 'dcim_manufacturer');
  assert.equal(cEvt.id, created.body.id);
  assert.equal(cEvt.data.name, 'Acme'); // full serialized object travels with the event

  await api('PATCH', `/api/dcim/manufacturers/${created.body.id}/`, { description: 'x' });
  const uEvt = await c.next((m) => m.type === 'change' && m.event === 'updated');
  assert.equal(uEvt.data.description, 'x');

  await api('DELETE', `/api/dcim/manufacturers/${created.body.id}/`);
  const dEvt = await c.next((m) => m.type === 'change' && m.event === 'deleted');
  assert.equal(dEvt.id, created.body.id);
  assert.equal(dEvt.data, undefined);

  c.ws.close();
});

test('multiple clients all receive events', async () => {
  const a = connect(wsUrl);
  const b = connect(wsUrl);
  await Promise.all([a.ready, b.ready]);
  await api('POST', '/api/ipam/rirs/', { name: 'RIPE', slug: 'ripe' });
  const [ea, eb] = await Promise.all([
    a.next((m) => m.type === 'change' && m.table === 'ipam_rir'),
    b.next((m) => m.type === 'change' && m.table === 'ipam_rir'),
  ]);
  assert.equal(ea.event, 'created');
  assert.equal(eb.event, 'created');
  a.ws.close();
  b.ws.close();
});

test('when auth is required, the WS rejects anonymous clients and accepts a token', async () => {
  const F = join(ROOT, 'test', '.rt-auth.sqlite');
  rmSync(F, { force: true });
  const adb = new SqliteDb(F);
  adb.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  adb.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  const u = await adb.execute('INSERT INTO users_user (username) VALUES (?)', ['svc']);
  const { key } = await createToken(adb, { userId: u.insertId, writeEnabled: true });

  const asrv = createApiServer({ db: adb, auth: { required: true }, realtime: true });
  await new Promise((r) => asrv.listen(0, '127.0.0.1', r));
  const aWs = `ws://127.0.0.1:${asrv.address().port}/api/ws/`;

  // anonymous (no credential) → closed with 1008, never receives hello
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(aWs);
    let gotHello = false;
    const t = setTimeout(() => reject(new Error('anonymous WS was not closed')), 3000);
    ws.addEventListener('message', (e) => {
      if (JSON.parse(e.data).type === 'hello') gotHello = true;
    });
    ws.addEventListener('close', (e) => {
      clearTimeout(t);
      assert.equal(gotHello, false, 'anonymous client must not receive the change feed');
      assert.equal(e.code, 1008);
      resolve();
    });
    ws.addEventListener('error', () => {}); // a close frame follows; ignore
  });

  // valid token in the query string → accepted (receives hello)
  const c = connect(`${aWs}?token=${key}`);
  await c.ready;
  const hello = await c.next((m) => m.type === 'hello');
  assert.ok(typeof hello.ts === 'number');
  c.ws.close();

  await new Promise((r) => asrv.close(r));
  await adb.close();
  rmSync(F, { force: true });
});
