// Syncing a VM's name to its OpenStack server (test/fake-openstack.mjs). Verifies:
//   - the request is validated (a non-empty name), reaches Nova as a PUT with the new name,
//     and is refused for a VM with no OpenStack server behind it
//   - the rename is journaled on the VM and on the cloud
//   - it never touches anything but the server's name (status, addresses, etc. are untouched)
// Run: node --test test/openstack-rename.test.mjs
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
const DB_FILE = join(ROOT, 'test', '.openstack-rename.sqlite');
const CLOUDS = '/api/plugins/openstack/clouds/';
const SERVERS = '/api/plugins/openstack/servers/';
const VM_TYPE = 'virtualization.virtualmachine';

let db, apiServer, base, os, cloudId, gra;

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
  for (let i = 0; i < 300; i++) {
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
const journalOf = async (vmId) =>
  (
    await db.query(
      `SELECT kind, comments FROM extras_journalentry
        WHERE assigned_object_type = ? AND assigned_object_id = ? ORDER BY id`,
      [VM_TYPE, vmId],
    )
  ).map((r) => ({ ...r }));
const cloudJournal = async () =>
  (
    await db.query(
      `SELECT comments FROM extras_journalentry
        WHERE assigned_object_type = 'plugins.openstackcloud' AND assigned_object_id = ?`,
      [cloudId],
    )
  ).map((r) => r.comments);

before(async () => {
  os = await startFakeOpenStack();
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0008_journalentry.sqlite.sql'), 'utf8'));
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
  cloudId = res.body.id;
  await until(async () => (await vmNamed('web-1'))?.id, 'the first sync');
});
after(async () => {
  await new Promise((r) => apiServer.close(r));
  await os.close();
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('a name is required, and a VM with no server behind it is a 404', async () => {
  const vm = await vmNamed('web-1');
  assert.equal((await api('PUT', `${SERVERS}${vm.id}/rename/`, { name: '' })).status, 400);
  assert.equal((await api('PUT', `${SERVERS}${vm.id}/rename/`, {})).status, 400);
  assert.equal(gra.renamed, undefined, 'nothing was sent to OpenStack');

  const plain = (
    await api('POST', '/api/virtualization/virtual-machines/', { name: 'plain', status: 'active' })
  ).body;
  assert.equal((await api('PUT', `${SERVERS}${plain.id}/rename/`, { name: 'x' })).status, 404);
});

test('renaming sends the new name to Nova and journals it on the VM and the cloud', async () => {
  const vm = await vmNamed('web-1');
  const res = await api('PUT', `${SERVERS}${vm.id}/rename/`, { name: 'web-1-renamed' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(gra.renamed.at(-1), { id: vm.server_id, name: 'web-1-renamed' });

  const serverOnCloud = gra.servers.find((s) => s.id === vm.server_id);
  assert.equal(serverOnCloud.name, 'web-1-renamed');
  assert.equal(serverOnCloud.status, 'ACTIVE', 'only the name changed, nothing else');

  const log = await journalOf(vm.id);
  assert.ok(
    log.some(
      (e) => e.kind === 'info' && e.comments.includes('Renamed to "web-1-renamed" on OpenStack'),
    ),
  );
  const cloudLog = await cloudJournal();
  assert.ok(cloudLog.some((c) => c.includes('Server renamed to "web-1-renamed" in GRA9')));

  // paashup's own name is unaffected by this route: it only pushes to OpenStack
  assert.equal((await vmNamed('web-1-renamed'))?.server_id, undefined);
  assert.ok(
    await db.get(`SELECT 1 FROM virtualization_virtual_machine WHERE id = ? AND name = 'web-1'`, [
      vm.id,
    ]),
  );
});
