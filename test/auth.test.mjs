// Feature: token authentication. Run: node --test test/auth.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { createToken } from '../dist/auth.js';

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
  }).then(async (r) => ({ status: r.status, body: await r.text().then((t) => (t ? JSON.parse(t) : undefined)) }));

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  // apply both migrations (0001 schema + 0002 auth_token)
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  // a user + tokens
  const u = await db.execute('INSERT INTO users_user (username) VALUES (?)', ['admin']);
  rwKey = (await createToken(db, { userId: u.insertId })).key;
  roKey = (await createToken(db, { userId: u.insertId, writeEnabled: false })).key;
  expiredKey = (await createToken(db, { userId: u.insertId, expires: '2000-01-01T00:00:00Z' })).key;

  server = createApiServer({ db, auth: { required: true } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await db.close(); rmSync(DB_FILE, { force: true }); });

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
  const created = await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' }, rwKey);
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

test('auth disabled by default (no auth option) allows anonymous', async () => {
  const open = createApiServer({ db }); // no auth
  await new Promise((r) => open.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${open.address().port}`;
  const r = await fetch(`${b}/api/dcim/manufacturers/`).then((x) => x.status);
  assert.equal(r, 200);
  await new Promise((r) => open.close(r));
});
