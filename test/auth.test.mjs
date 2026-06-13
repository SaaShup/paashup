// Feature: token authentication. Run: node --test test/auth.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { createToken, ensureSeedToken } from '../dist/auth.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.auth.sqlite');
let db, server, base, rwKey, roKey, expiredKey;

const api = (m, p, b, token) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: {
      ...(b ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({
    status: r.status,
    body: await r.text().then((t) => (t ? JSON.parse(t) : undefined)),
  }));

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  // apply both migrations (0001 schema + 0002 auth_token)
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  // a user + tokens
  const u = await db.execute('INSERT INTO users_user (username, is_active) VALUES (?, 1)', [
    'admin',
  ]);
  rwKey = (await createToken(db, { userId: u.insertId })).key;
  roKey = (await createToken(db, { userId: u.insertId, writeEnabled: false })).key;
  expiredKey = (await createToken(db, { userId: u.insertId, expires: '2000-01-01T00:00:00Z' })).key;

  server = createApiServer({ db, auth: { required: true } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('no token -> 403', async () => {
  const r = await api('GET', '/api/dcim/manufacturers/');
  assert.equal(r.status, 403);
  assert.match(r.body.detail, /credentials were not provided/);
});

test('invalid token -> 403', async () => {
  const r = await api('GET', '/api/dcim/manufacturers/', null, 'deadbeef');
  assert.equal(r.status, 403);
});

test('valid token -> 200 read and 201 write', async () => {
  const list = await api('GET', '/api/dcim/manufacturers/', null, rwKey);
  assert.equal(list.status, 200);
  const created = await api(
    'POST',
    '/api/dcim/manufacturers/',
    { name: 'Acme', slug: 'acme' },
    rwKey,
  );
  assert.equal(created.status, 201);
});

test('read-only token: GET ok, write -> 403', async () => {
  const list = await api('GET', '/api/dcim/manufacturers/', null, roKey);
  assert.equal(list.status, 200);
  const w = await api('POST', '/api/dcim/manufacturers/', { name: 'No', slug: 'no' }, roKey);
  assert.equal(w.status, 403);
  assert.match(w.body.detail, /read-only/);
});

test('expired token -> 403', async () => {
  const r = await api('GET', '/api/dcim/manufacturers/', null, expiredKey);
  assert.equal(r.status, 403);
});

test('ensureSeedToken provisions a working token from env (idempotent)', async () => {
  const seedKey = 'seed00000000000000000000000000000000beef';
  const prev = { t: process.env.PB_SEED_TOKEN, u: process.env.PB_SEED_USERNAME };
  process.env.PB_SEED_TOKEN = seedKey;
  process.env.PB_SEED_USERNAME = 'admin';
  try {
    const first = await ensureSeedToken(db);
    assert.equal(first?.created, true);
    // the seeded key authenticates against the auth-required server (read + write)
    assert.equal((await api('GET', '/api/dcim/manufacturers/', null, seedKey)).status, 200);
    const w = await api(
      'POST',
      '/api/dcim/manufacturers/',
      { name: 'Seeded', slug: 'seeded' },
      seedKey,
    );
    assert.equal(w.status, 201);
    // running again is a no-op — no duplicate row
    assert.equal((await ensureSeedToken(db))?.created, false);
    const row = await db.get('SELECT COUNT(*) AS n FROM auth_token WHERE `key` = ?', [seedKey]);
    assert.equal(Number(row.n), 1);
  } finally {
    if (prev.t === undefined) delete process.env.PB_SEED_TOKEN;
    else process.env.PB_SEED_TOKEN = prev.t;
    if (prev.u === undefined) delete process.env.PB_SEED_USERNAME;
    else process.env.PB_SEED_USERNAME = prev.u;
  }
});

test('auth disabled by default (no auth option) allows anonymous', async () => {
  const open = createApiServer({ db }); // no auth
  await new Promise((r) => open.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${open.address().port}`;
  const r = await fetch(`${b}/api/dcim/manufacturers/`).then((x) => x.status);
  assert.equal(r, 200);
  await new Promise((r) => open.close(r));
});

test('a token whose owning user is deactivated is rejected (is_active gate)', async () => {
  const u = await db.execute('INSERT INTO users_user (username, is_active) VALUES (?, 0)', [
    'disabled',
  ]);
  const key = (await createToken(db, { userId: u.insertId })).key;
  assert.equal((await api('GET', '/api/dcim/manufacturers/', null, key)).status, 403);
});

test('bulk create/update is capped at 1000 objects', async () => {
  const big = Array.from({ length: 1001 }, (_, i) => ({ name: `m${i}`, slug: `m${i}` }));
  const r = await api('POST', '/api/dcim/manufacturers/', big, rwKey);
  assert.equal(r.status, 400);
  assert.match(r.body.detail, /limited to 1000/);
});
