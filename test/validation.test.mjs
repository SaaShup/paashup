// Feature: pre-write validation with NetBox field-error shape. Run: node --test test/validation.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.val.sqlite');
let db, server, base;
const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await db.close(); rmSync(DB_FILE, { force: true }); });

test('missing required field -> 400 field error', async () => {
  const r = await api('POST', '/api/dcim/manufacturers/', { slug: 'no-name' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.name, ['This field is required.']);
});

test('invalid enum choice -> 400 field error (before DB)', async () => {
  const r = await api('POST', '/api/ipam/prefixes/', { prefix: '10.0.0.0/8', status: 'bogus' });
  assert.equal(r.status, 400);
  assert.match(r.body.status[0], /not a valid choice/);
});

test('wrong type and null-on-non-nullable -> 400', async () => {
  const r = await api('POST', '/api/dcim/manufacturers/', { name: 123, slug: null });
  assert.equal(r.status, 400);
  assert.ok(r.body.name); // name must be string
  assert.ok(r.body.slug); // slug may not be null
});

test('maxLength enforced', async () => {
  const r = await api('POST', '/api/dcim/manufacturers/', { name: 'x'.repeat(300), slug: 'toolong' });
  assert.equal(r.status, 400);
  assert.match(r.body.name[0], /at most \d+ characters/);
});

test('multiple field errors reported together', async () => {
  const r = await api('POST', '/api/ipam/prefixes/', { status: 'bogus' }); // missing prefix + bad status
  assert.equal(r.status, 400);
  assert.ok(r.body.prefix && r.body.status);
});

test('PATCH skips required check but still validates provided fields', async () => {
  const m = (await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' })).body;
  const ok = await api('PATCH', `/api/dcim/manufacturers/${m.id}/`, { description: 'fine' });
  assert.equal(ok.status, 200);
  const bad = await api('PATCH', `/api/dcim/manufacturers/${m.id}/`, { name: 42 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.name);
});

test('valid payload still succeeds', async () => {
  const r = await api('POST', '/api/ipam/prefixes/', { prefix: '2001:db8::/32', status: 'active' });
  assert.equal(r.status, 201);
  assert.equal(r.body.status.value, 'active');
});
