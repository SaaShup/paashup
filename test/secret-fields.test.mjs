// Write-only secret columns: a column flagged `secret` in its metadata is accepted on
// write but NEVER returned on read (serializer + OpenAPI omit it). Exercised here on the
// webhook `secret`; the identical flag protects the Cloudflare token and Docker registry
// password. Run: node --test test/secret-fields.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { buildOpenApi } from '../dist/api/openapi.js';
import { getTable } from '../dist/model/registry.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.secret.sqlite');
let db, server, base;

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
  db.exec(
    readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
  );
  db.exec(readFileSync(join(ROOT, 'migrations', '0010_webhook_template.sqlite.sql'), 'utf8'));
  server = createApiServer({ db }); // registers the webhook entity as a side effect
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('a secret is accepted on write, stored, but never returned on read', async () => {
  const created = await api('POST', '/api/extras/webhooks/', {
    name: 'wh',
    payload_url: 'http://example.com/hook',
    object_types: ['dcim.manufacturer'],
    events: ['created'],
    secret: 's3cr3t-value',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.secret, undefined, 'secret not echoed on create');
  assert.equal(created.body.name, 'wh'); // non-secret fields still present
  const id = created.body.id;

  const got = await api('GET', `/api/extras/webhooks/${id}/`);
  assert.equal(got.status, 200);
  assert.equal(got.body.secret, undefined, 'secret absent on detail GET');
  assert.equal(got.body.name, 'wh');

  const list = await api('GET', '/api/extras/webhooks/');
  assert.ok(
    list.body.results.every((w) => w.secret === undefined),
    'secret absent in list results',
  );

  // write-only, not write-discarded: the value is actually stored
  const row = await db.get('SELECT secret FROM extras_webhook WHERE id = ?', [id]);
  assert.equal(row.secret, 's3cr3t-value');
});

test('OpenAPI omits secret columns from read/brief schemas but keeps them writable', () => {
  const doc = buildOpenApi();
  const M = getTable('extras_webhook').model; // component key, e.g. "Webhook"
  const read = doc.components.schemas[M].properties;
  const write = doc.components.schemas[`${M}Request`].properties;
  assert.equal(read.secret, undefined, 'read schema omits secret');
  assert.ok(write.secret, 'write schema keeps secret (still writable)');
});
