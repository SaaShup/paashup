// Reinstalling VMs (rebuilding from another image) on OpenStack from paashup, end to end
// against the fake cloud (test/fake-openstack.mjs). Verifies:
//   - the request is validated (an image known in the region), reaches Nova as a rebuild action,
//     and is refused for a VM with no OpenStack server behind it
//   - the reinstall is journaled on the VM and the cloud as soon as it's requested, then the VM
//     is followed through REBUILD: once it settles active, the VM's image is refreshed from the
//     new one
//   - while OpenStack still reports the server rebuilding, connected pages get a transient
//     `_reinstalling` hint on the live feed, never stored, cleared once it settles
// Run: node --test test/openstack-reinstall.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PB_OPENSTACK_POLL_MS = '20'; // read when the plugin loads: follow reinstalls fast

const { SqliteDb } = await import('../dist/db/sqlite.js');
const { loadPlugins } = await import('../dist/plugins/runtime.js');
const { createApiServer } = await import('../dist/api/server.js');
const { default: openstackPlugin } = await import('../dist/plugins/openstack/index.js');
const { region, server, startFakeOpenStack } = await import('./fake-openstack.mjs');

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.openstack-reinstall.sqlite');
const CLOUDS = '/api/plugins/openstack/clouds/';
const SERVERS = '/api/plugins/openstack/servers/';
const VM_TABLE = 'virtualization_virtual_machine';
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
  for (let i = 0; i < 1500; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const vmNamed = (name) =>
  db.get(
    `SELECT v.id, v.status, s.server_id
       FROM virtualization_virtual_machine v
       JOIN plugin_openstack_server s ON s.virtual_machine_id = v.id WHERE v.name = ?`,
    [name],
  );
const vmById = async (id) =>
  db.get(
    `SELECT v.status, i.name AS image_name
       FROM virtualization_virtual_machine v
       LEFT JOIN virtualization_image i ON i.id = v.image_id
      WHERE v.id = ?`,
    [id],
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

  gra = region({
    servers: [server('srv-1', 'web-1')],
    images: [
      { id: 'img-ubuntu', name: 'Ubuntu 22.04', status: 'active' },
      { id: 'img-debian', name: 'Debian 12', status: 'active' },
    ],
  });
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

test('an image is required and must exist in the region, and a VM with no server behind it is a 404', async () => {
  const vm = await vmNamed('web-1');
  assert.equal((await api('POST', `${SERVERS}${vm.id}/reinstall/`, {})).status, 400);
  assert.equal(
    (await api('POST', `${SERVERS}${vm.id}/reinstall/`, { image_id: 'no-such-image' })).status,
    400,
  );
  assert.equal(gra.rebuilt, undefined, 'nothing was requested on OpenStack');

  const plain = (
    await api('POST', '/api/virtualization/virtual-machines/', { name: 'plain', status: 'active' })
  ).body;
  assert.equal(
    (await api('POST', `${SERVERS}${plain.id}/reinstall/`, { image_id: 'img-debian' })).status,
    404,
  );
});

test('a reinstall reaches Nova, is journaled, and the VM picks up the new image', async () => {
  const vm = await vmNamed('web-1');
  const res = await api('POST', `${SERVERS}${vm.id}/reinstall/`, { image_id: 'img-debian' });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.deepEqual(gra.rebuilt.at(-1), { id: vm.server_id, imageId: 'img-debian' });

  const log = await until(async () => {
    const l = await journalOf(vm.id);
    return l.length >= 2 ? l : null;
  }, 'the reinstall to be followed through');
  assert.equal(log[0].kind, 'warning');
  assert.match(
    log[0].comments,
    /Reinstall from "Debian 12" requested on OpenStack \(region GRA9\)/,
  );
  assert.equal(log[1].kind, 'success');
  assert.match(log[1].comments, /reinstalled from "Debian 12"/);

  const row = await until(async () => {
    const r = await vmById(vm.id);
    return r.image_name === 'Debian 12' ? r : null;
  }, 'the VM to pick up the new image');
  assert.equal(row.status, 'active');

  const cloudLog = await cloudJournal();
  assert.ok(
    cloudLog.some((c) => /Reinstall of server "web-1" from "Debian 12" requested in GRA9/.test(c)),
  );
  assert.ok(cloudLog.some((c) => /Server "web-1" reinstalled from "Debian 12" in GRA9/.test(c)));
});

test('a failed reinstall ends the VM failed with the reason journaled, and leaves the old image', async () => {
  const vm = await vmNamed('web-1'); // already on Debian 12 from the previous test
  gra.failRebuild = 'No valid host was found';
  const res = await api('POST', `${SERVERS}${vm.id}/reinstall/`, { image_id: 'img-ubuntu' });
  assert.equal(res.status, 202);
  assert.deepEqual(gra.rebuilt.at(-1), { id: vm.server_id, imageId: 'img-ubuntu' });

  await until(async () => (await vmById(vm.id)).status === 'failed', 'the VM to end up failed');
  const log = await journalOf(vm.id);
  assert.ok(
    log.some(
      (e) => e.kind === 'warning' && /Reinstall from "Ubuntu 22.04" requested/.test(e.comments),
    ),
  );
  assert.ok(
    log.some(
      (e) => e.kind === 'danger' && e.comments.includes('ended up "ERROR" after the reinstall'),
    ),
  );
  const cloudLog = await cloudJournal();
  assert.ok(
    cloudLog.some((c) =>
      c.includes('ended up "ERROR" after a reinstall from "Ubuntu 22.04" in GRA9'),
    ),
  );

  const row = await vmById(vm.id);
  assert.equal(row.image_name, 'Debian 12', "the VM wasn't moved to the failed image's name");
  gra.failRebuild = null;
});

test('while the server is reinstalling, connected pages get a transient hint, cleared once it settles', async () => {
  const vm = await vmNamed('web-1');
  await db.execute(`UPDATE virtualization_virtual_machine SET status = 'active' WHERE id = ?`, [
    vm.id,
  ]);
  const events = [];
  const ws = new WebSocket(`ws://127.0.0.1:${apiServer.address().port}/api/ws/`);
  ws.addEventListener('message', (e) => events.push(JSON.parse(e.data)));
  await new Promise((r) => ws.addEventListener('open', r));
  const before = events.length;
  const mine = () =>
    events
      .slice(before)
      .filter((e) => e.type === 'change' && e.table === VM_TABLE && e.id === vm.id);

  gra.rebuildReads = 2; // stay in REBUILD for a couple of polls so the hint is observable
  const res = await api('POST', `${SERVERS}${vm.id}/reinstall/`, { image_id: 'img-ubuntu' });
  assert.equal(res.status, 202);

  const flaggedAt = await until(() => {
    const i = mine().findIndex((e) => e.data?._reinstalling === true);
    return i >= 0 ? i + 1 : null;
  }, 'the reinstalling hint');
  await until(
    () =>
      mine()
        .slice(flaggedAt)
        .some((e) => e.event === 'updated' && e.data && !('_reinstalling' in e.data)),
    'a final push clearing the hint',
  );

  await until(async () => (await vmById(vm.id)).status === 'active', 'the VM to settle active');
  gra.rebuildReads = 1;
  ws.close();
});
