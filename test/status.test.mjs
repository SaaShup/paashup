// NetBox-shaped status/health endpoint: public GET /api/status/. Verifies the payload
// shape, the version source (package.json), and that it stays reachable without auth even
// when the API is secure-by-default. Run: node --test test/status.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { appVersion, NETBOX_VERSION } from '../dist/version.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.status.sqlite');
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
let db, server, base;

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  // secure-by-default server — status must still be reachable anonymously
  server = createApiServer({ db, auth: { required: true }, realtime: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('GET /api/status/ is public (no auth), 200, JSON', async () => {
  const res = await fetch(`${base}/api/status/`); // no Authorization header
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
});

test('payload is NetBox-shaped and reports the right versions', async () => {
  const body = await fetch(`${base}/api/status/`).then((r) => r.json());
  assert.equal(body.status, 'ok');
  assert.ok(body.version, 'version present');
  assert.equal(body.version, PKG_VERSION); // sourced from package.json
  assert.equal(body['paas2box-version'], PKG_VERSION);
  assert.equal(body['netbox-version'], NETBOX_VERSION);
  assert.equal(typeof body['node-version'], 'string');
  assert.equal(typeof body.plugins, 'object'); // NetBox-style {name: version} map
  assert.ok(!Array.isArray(body.plugins));
});

test('appVersion() matches package.json and falls back to "unknown"', () => {
  assert.equal(appVersion(), PKG_VERSION);
  // injected bad path bypasses the cache → exercises the fallback
  assert.equal(appVersion(pathToFileURL('/no/such/package.json')), 'unknown');
});
