// Single-container: the API serves a built SPA for non-/api GET routes.
// Run: node --test test/static.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
import { readFileSync } from 'node:fs';
let db, server, base, webRoot;

before(async () => {
  webRoot = mkdtempSync(join(tmpdir(), 'pbx-web-'));
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>paasbox spa</title>');
  mkdirSync(join(webRoot, 'assets'));
  writeFileSync(join(webRoot, 'assets', 'app.js'), 'console.log("hi")');

  db = new SqliteDb(join(webRoot, 'db.sqlite'));
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db, webRoot });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(webRoot, { recursive: true, force: true });
});

test('serves index.html at /', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /paasbox spa/);
});

test('serves static assets with correct content-type', async () => {
  const r = await fetch(`${base}/assets/app.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(await r.text(), /console\.log/);
});

test('SPA fallback: unknown non-API path returns index.html', async () => {
  const r = await fetch(`${base}/some/client/route`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /paasbox spa/);
});

test('API still works (not shadowed by static)', async () => {
  const r = await fetch(`${base}/api/dcim/manufacturers/`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok('results' in body);
});

test('path traversal is blocked', async () => {
  const r = await fetch(`${base}/../../etc/passwd`);
  // normalized by fetch/server; must not leak files — index fallback or 403/404
  const text = await r.text();
  assert.ok(!text.includes('root:'));
});
