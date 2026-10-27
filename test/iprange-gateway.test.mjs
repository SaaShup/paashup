// IP range gateway field (paashup extension): an optional IP that must fall within
// the range. Run: node --test test/iprange-gateway.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.gw.sqlite');
let db, server, base;

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const range = (extra) => ({
  start_address: '10.0.0.1/24',
  end_address: '10.0.0.254/24',
  status: 'active',
  ...extra,
});

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('gateway field is exposed (null by default)', async () => {
  const r = await api('POST', '/api/ipam/ip-ranges/', range());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok('gateway' in r.body);
  assert.equal(r.body.gateway, null);
});

test('accepts a gateway within the range', async () => {
  const r = await api('POST', '/api/ipam/ip-ranges/', range({ gateway: '10.0.0.1' }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.gateway, '10.0.0.1');
});

test('rejects a gateway outside the range', async () => {
  const r = await api('POST', '/api/ipam/ip-ranges/', range({ gateway: '10.0.5.5' }));
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.gateway));
});

test('rejects an invalid IP', async () => {
  const r = await api('POST', '/api/ipam/ip-ranges/', range({ gateway: 'not-an-ip' }));
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.gateway));
});

test('PATCH gateway is validated against stored bounds when sent with them', async () => {
  const created = await api('POST', '/api/ipam/ip-ranges/', range());
  const id = created.body.id;
  // gateway-only PATCH: format checked, accepted
  const ok = await api('PATCH', `/api/ipam/ip-ranges/${id}/`, { gateway: '10.0.0.9' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.gateway, '10.0.0.9');
});

test('dhcp_relays accepts a list of valid IPs', async () => {
  const r = await api(
    'POST',
    '/api/ipam/ip-ranges/',
    range({ dhcp_relays: ['10.1.0.1', '10.1.0.2'] }),
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.dhcp_relays, ['10.1.0.1', '10.1.0.2']);
});

test('dhcp_relays rejects an invalid IP in the list', async () => {
  const r = await api('POST', '/api/ipam/ip-ranges/', range({ dhcp_relays: ['10.1.0.1', 'nope'] }));
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.dhcp_relays));
});

test('dhcp_relays rejects a non-list value', async () => {
  const r = await api('POST', '/api/ipam/ip-ranges/', range({ dhcp_relays: '10.1.0.1' }));
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.dhcp_relays));
});
