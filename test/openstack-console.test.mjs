// The VM console: GET /servers/{vm_id}/console/ asks Nova for a one-time noVNC console URL
// (test/fake-openstack.mjs). Verifies:
//   - a VM with a server behind it gets back the { type, url } Nova returned
//   - a VM with no OpenStack server behind it is a 404
//   - a cloud that doesn't support the VNC console (e.g. OVH, serial-console-only) surfaces
//     Nova's error as a 502 with a detail message, not a crash
// Run: node --test test/openstack-console.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { SqliteDb } = await import('../dist/db/sqlite.js');
const { loadPlugins } = await import('../dist/plugins/runtime.js');
const { createApiServer } = await import('../dist/api/server.js');
const { default: openstackPlugin } = await import('../dist/plugins/openstack/index.js');
const { region, server, startFakeOpenStack } = await import('./fake-openstack.mjs');

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.openstack-console.sqlite');
const CLOUDS = '/api/plugins/openstack/clouds/';
const SERVERS = '/api/plugins/openstack/servers/';

let db, apiServer, base, os, gra;

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};
const until = async (fn, what) => {
  for (let i = 0; i < 1500; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const vmNamed = (name) =>
  db.get(
    `SELECT v.id, v.status, s.server_id FROM virtualization_virtual_machine v
       JOIN plugin_openstack_server s ON s.virtual_machine_id = v.id WHERE v.name = ?`,
    [name],
  );

before(async () => {
  os = await startFakeOpenStack();
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [openstackPlugin]);
  apiServer = createApiServer({ db, realtime: true });
  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${apiServer.address().port}`;

  gra = region({ servers: [server('srv-1', 'web-1')] });
  os.state.regions = { GRA9: gra };
  const res = await api('POST', CLOUDS, {
    name: 'ovh',
    auth_url: os.authUrl,
    username: os.state.user,
    password: os.state.password,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await until(async () => (await vmNamed('web-1'))?.id, 'the first sync');
});
after(async () => {
  await new Promise((r) => apiServer.close(r));
  await os.close();
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test("a VM with a server behind it gets Nova's one-time console URL", async () => {
  const vm = await vmNamed('web-1');
  const res = await api('GET', `${SERVERS}${vm.id}/console/`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.type, 'novnc');
  assert.equal(res.body.url, `https://novnc.example/vnc_auto.html?token=${vm.server_id}-tok`);
  assert.deepEqual(gra.vncConsoled.at(-1), vm.server_id);
});

test('a VM with no OpenStack server behind it is a 404', async () => {
  const plain = (
    await api('POST', '/api/virtualization/virtual-machines/', { name: 'plain', status: 'active' })
  ).body;
  assert.equal((await api('GET', `${SERVERS}${plain.id}/console/`)).status, 404);
  assert.equal((await api('GET', `${SERVERS}99999/console/`)).status, 404);
});

test("a cloud that doesn't support the VNC console surfaces Nova's error, not a crash", async () => {
  const vm = await vmNamed('web-1');
  gra.noVncConsole = true;
  const res = await api('GET', `${SERVERS}${vm.id}/console/`);
  assert.equal(res.status, 502);
  assert.match(res.body.detail, /Unavailable console type/);
  gra.noVncConsole = false;
});
