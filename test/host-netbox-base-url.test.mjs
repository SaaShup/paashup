// Issue #33: `netbox_base_url` is auto-populated from the request origin on host
// create when omitted, never overwrites a provided value, prefers an operator-
// configured public URL, and only trusts X-Forwarded-* when PB_TRUST_PROXY=1.
// Run: node --test test/host-netbox-base-url.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { createApiServer } from '../dist/api/server.js';
import dockerPlugin from '../dist/plugins/docker/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.host-netbox-base-url.sqlite');

let db, server, base, cfgServer, cfgBase;
const CONFIGURED = 'https://configured.example.com';

// POST a host with optional extra request headers; returns { status, body }.
async function postHost(b, headers = {}, target = base) {
  const res = await fetch(`${target}/api/plugins/docker/hosts/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(b),
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
}

const stored = (id) => db.get('SELECT netbox_base_url FROM plugin_docker_host WHERE id = ?', [id]);

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin]);

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // a second instance with an operator-configured public base URL
  cfgServer = createApiServer({ db, baseUrl: CONFIGURED });
  await new Promise((r) => cfgServer.listen(0, '127.0.0.1', r));
  cfgBase = `http://127.0.0.1:${cfgServer.address().port}`;
});

after(() => {
  server?.close();
  cfgServer?.close();
  db?.close();
  rmSync(DB_FILE, { force: true });
  delete process.env.PB_TRUST_PROXY;
});

test('omitted netbox_base_url defaults to the request origin', async () => {
  const { status, body } = await postHost({ name: 'h-omit', endpoint: 'http://agent:1880' });
  assert.equal(status, 201);
  assert.equal(body.netbox_base_url, base); // serialized response carries it
  assert.equal((await stored(body.id)).netbox_base_url, base); // and it's persisted
});

test('a provided netbox_base_url is preserved verbatim', async () => {
  const explicit = 'https://cmdb.mycorp.internal';
  const { status, body } = await postHost({
    name: 'h-explicit',
    endpoint: 'http://agent:1880',
    netbox_base_url: explicit,
  });
  assert.equal(status, 201);
  assert.equal((await stored(body.id)).netbox_base_url, explicit);
});

test('X-Forwarded-* are ignored unless PB_TRUST_PROXY=1', async () => {
  delete process.env.PB_TRUST_PROXY;
  const { body } = await postHost(
    { name: 'h-noproxy', endpoint: 'http://agent:1880' },
    { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'spoofed.example.com' },
  );
  assert.equal((await stored(body.id)).netbox_base_url, base); // forwarded headers ignored
});

test('X-Forwarded-Proto/Host are honored when PB_TRUST_PROXY=1', async () => {
  process.env.PB_TRUST_PROXY = '1';
  try {
    const { body } = await postHost(
      { name: 'h-proxy', endpoint: 'http://agent:1880' },
      { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'cmdb.example.com' },
    );
    assert.equal((await stored(body.id)).netbox_base_url, 'https://cmdb.example.com');
  } finally {
    delete process.env.PB_TRUST_PROXY;
  }
});

test('an operator-configured public URL wins over headers (even with trust on)', async () => {
  process.env.PB_TRUST_PROXY = '1';
  try {
    const { body } = await postHost(
      { name: 'h-configured', endpoint: 'http://agent:1880' },
      { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'spoofed.example.com' },
      cfgBase,
    );
    assert.equal((await stored(body.id)).netbox_base_url, CONFIGURED);
  } finally {
    delete process.env.PB_TRUST_PROXY;
  }
});

test('bulk create defaults each omitted netbox_base_url', async () => {
  const { status, body } = await postHost([
    { name: 'h-bulk-1', endpoint: 'http://agent:1880' },
    { name: 'h-bulk-2', endpoint: 'http://agent:1880', netbox_base_url: 'https://kept.example' },
  ]);
  assert.equal(status, 201);
  assert.equal((await stored(body[0].id)).netbox_base_url, base);
  assert.equal((await stored(body[1].id)).netbox_base_url, 'https://kept.example');
});
