// The server publishes its own OpenAPI schema at /api/schema/, generated from the
// live registry (core + plugins). Run: node --test test/openapi.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import inventoryPlugin from '../dist/plugins/examples/inventory.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.openapi.sqlite');
let db, server, base;
const get = async (p) => {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
};

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [inventoryPlugin]);
  server = createApiServer({ db, auth: { required: true } }); // schema must be public even so
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('/api/schema/ is public and returns an OpenAPI 3.0 document', async () => {
  const r = await get('/api/schema/');
  assert.equal(r.status, 200); // public despite auth.required
  const doc = JSON.parse(r.text);
  assert.equal(doc.openapi, '3.0.3');
  assert.ok(doc.info && doc.paths && doc.components);
  assert.deepEqual(doc.servers?.[0]?.url, base);
  assert.ok(doc.components.securitySchemes.tokenAuth);
});

test('schema includes core paths + schemas', async () => {
  const doc = JSON.parse((await get('/api/schema/')).text);
  assert.ok(doc.paths['/api/dcim/manufacturers/']);
  assert.ok(doc.paths['/api/dcim/manufacturers/{id}/']);
  for (const name of [
    'Manufacturer',
    'ManufacturerBrief',
    'PaginatedManufacturerList',
    'ManufacturerRequest',
  ]) {
    assert.ok(doc.components.schemas[name], `missing component ${name}`);
  }
  // FK serialized as a nested brief ref
  const dt = doc.components.schemas.DeviceType.properties.manufacturer;
  assert.ok(JSON.stringify(dt).includes('ManufacturerBrief'));
  // choice field as {value,label}
  const status = doc.components.schemas.Prefix.properties.status;
  assert.equal(status.type, 'object');
  assert.ok(status.properties.value && status.properties.label);
  // computed family present on IP entities
  assert.ok(doc.components.schemas.Prefix.properties.family);
});

test('schema includes PLUGIN paths + schemas', async () => {
  const doc = JSON.parse((await get('/api/schema/')).text);
  assert.ok(doc.paths['/api/plugins/inventory/assets/'], 'plugin collection path missing');
  assert.ok(doc.paths['/api/plugins/inventory/assets/{id}/'], 'plugin detail path missing');
  assert.ok(doc.components.schemas.InventoryAsset);
  const st = doc.components.schemas.InventoryAsset.properties.status;
  assert.deepEqual(st.properties.value.enum, ['in-stock', 'deployed', 'retired']);
});

test('read-only entity exposes only GET', async () => {
  const doc = JSON.parse((await get('/api/schema/')).text);
  const ro = doc.paths['/api/dcim/cable-terminations/'];
  assert.ok(ro.get);
  assert.equal(ro.post, undefined);
});

test('schema documents the custom (non-CRUD) routes', async () => {
  const doc = JSON.parse((await get('/api/schema/')).text);
  for (const p of [
    '/api/status/',
    '/api/plugins/',
    '/api/auth/oidc-config/',
    '/api/auth/providers/',
    '/api/auth/oidc/exchange/',
    '/api/users/tokens/',
    '/api/users/tokens/{id}/',
  ]) {
    assert.ok(doc.paths[p], `missing custom path ${p}`);
  }
  // public endpoints opt out of auth; token endpoints use the default (tokenAuth)
  assert.deepEqual(doc.paths['/api/status/'].get.security, []);
  assert.equal('security' in doc.paths['/api/users/tokens/'].get, false);
  assert.ok(doc.components.schemas.APIToken && doc.components.schemas.PaginatedAPITokenList);
  // docker isn't loaded in this test, so its agent actions must NOT appear
  assert.equal(doc.paths['/api/plugins/docker/images/{id}/force_pull/'], undefined);
});

test('published schema is self-consistent (every $ref resolves)', async () => {
  const doc = JSON.parse((await get('/api/schema/')).text);
  const defined = new Set(Object.keys(doc.components.schemas));
  const refs = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        if (k === '$ref' && typeof v === 'string') refs.push(v);
        else walk(v);
      }
    }
  };
  walk(doc.paths);
  walk(doc.components.schemas);
  const SP = '#/components/schemas/';
  const dangling = [...new Set(refs)].filter(
    (r) => r.startsWith(SP) && !defined.has(r.slice(SP.length)),
  );
  assert.deepEqual(dangling, [], `dangling $refs: ${dangling.join(', ')}`);
  assert.ok(refs.length > 100); // sanity: refs actually present
});

test('swagger-ui page is served', async () => {
  const r = await get('/api/schema/swagger-ui/');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.text, /swagger-ui/);
});
