// Feature: self-service API-key management (/api/users/tokens/). A signed-in user
// creates/lists/revokes their own keys; the full key shows once, then masked; the
// key authenticates as its owner; last_used is recorded; keys are scoped per-user.
// Run: node --test test/api-keys.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { createToken } from '../dist/auth.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.api-keys.sqlite');
let db, server, base, aKey, bKey;

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
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  // two users, each with a bootstrap read-write token to call the API
  const a = await db.execute('INSERT INTO users_user (username, is_active) VALUES (?, 1)', [
    'alice',
  ]);
  const b = await db.execute('INSERT INTO users_user (username, is_active) VALUES (?, 1)', ['bob']);
  aKey = (await createToken(db, { userId: a.insertId })).key;
  bKey = (await createToken(db, { userId: b.insertId })).key;

  server = createApiServer({ db, auth: { required: true } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('unauthenticated -> 403', async () => {
  const r = await api('GET', '/api/users/tokens/');
  assert.equal(r.status, 403);
});

test('create returns the full key once (40-hex)', async () => {
  const r = await api('POST', '/api/users/tokens/', { description: 'ci' }, aKey);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.key, /^[0-9a-f]{40}$/); // full key, shown once
  assert.equal(r.body.description, 'ci');
  assert.equal(r.body.write_enabled, true);
  assert.ok(r.body.created);
});

test('list masks the key but keeps the last-4 hint', async () => {
  const list = await api('GET', '/api/users/tokens/', null, aKey);
  assert.equal(list.status, 200);
  assert.ok(list.body.count >= 1);
  for (const t of list.body.results) {
    assert.match(t.key, /^•+[0-9a-f]{4}$/); // masked, ends in last4
    assert.equal(t.key.slice(-4), t.last4);
    assert.equal(t.key.length, 40); // same length as the real key, masked but for last4
    assert.ok(!/^[0-9a-f]{40}$/.test(t.key)); // never the full plaintext key
  }
});

test('a created key authenticates as its owner and records last_used', async () => {
  const made = await api('POST', '/api/users/tokens/', { description: 'use-me' }, aKey);
  const newKey = made.body.key;
  // newly created -> last_used null
  let row = (await api('GET', '/api/users/tokens/', null, aKey)).body.results.find(
    (t) => t.description === 'use-me',
  );
  assert.equal(row.last_used, null);
  // use it
  const r = await api('GET', '/api/dcim/manufacturers/', null, newKey);
  assert.equal(r.status, 200);
  // last_used now populated
  row = (await api('GET', '/api/users/tokens/', null, aKey)).body.results.find(
    (t) => t.description === 'use-me',
  );
  assert.ok(row.last_used, 'last_used should be set after use');
});

test('a read-only key can read but not write', async () => {
  const made = await api(
    'POST',
    '/api/users/tokens/',
    { description: 'ro', write_enabled: false },
    aKey,
  );
  const roKey = made.body.key;
  assert.equal(made.body.write_enabled, false);
  assert.equal((await api('GET', '/api/dcim/manufacturers/', null, roKey)).status, 200);
  const w = await api('POST', '/api/dcim/manufacturers/', { name: 'X', slug: 'x' }, roKey);
  assert.equal(w.status, 403);
});

test('an expired key is rejected', async () => {
  const made = await api(
    'POST',
    '/api/users/tokens/',
    { description: 'old', expires: '2000-01-01T00:00:00Z' },
    aKey,
  );
  assert.equal(made.status, 201);
  const r = await api('GET', '/api/dcim/manufacturers/', null, made.body.key);
  assert.equal(r.status, 403);
});

test('revoke deletes the key and it stops authenticating', async () => {
  const made = await api('POST', '/api/users/tokens/', { description: 'doomed' }, aKey);
  const id = made.body.id;
  assert.equal((await api('GET', '/api/dcim/manufacturers/', null, made.body.key)).status, 200);
  const del = await api('DELETE', `/api/users/tokens/${id}/`, null, aKey);
  assert.equal(del.status, 204);
  assert.equal((await api('GET', '/api/dcim/manufacturers/', null, made.body.key)).status, 403);
});

test('keys are scoped: a user cannot see or delete another user’s keys', async () => {
  const mine = await api('POST', '/api/users/tokens/', { description: 'alice-only' }, aKey);
  // bob's list never contains alice's tokens
  const bobList = await api('GET', '/api/users/tokens/', null, bKey);
  assert.ok(!bobList.body.results.some((t) => t.id === mine.body.id));
  // bob deleting alice's token -> 404 (and it still works for alice)
  const del = await api('DELETE', `/api/users/tokens/${mine.body.id}/`, null, bKey);
  assert.equal(del.status, 404);
  assert.equal((await api('GET', '/api/dcim/manufacturers/', null, mine.body.key)).status, 200);
});
