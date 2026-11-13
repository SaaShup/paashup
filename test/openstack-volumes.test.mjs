// Standalone Cinder volume management (src/plugins/openstack/volumes.ts), independent of the
// single-slot "data volume" convenience flow covered in openstack-vm.test.mjs. Verifies:
//   - a volume can be created without attaching it to any VM (nothing written to paashup's DB)
//   - a volume created with a VM chosen is attached once available, and mirrored right away
//   - an existing unattached volume can be attached to a VM later; an already-attached one can't
//   - detaching keeps the volume by default, deletes it only when asked
//   - an unattached volume can be deleted outright; an attached one refuses
//   - the Cinder volume types of a region are exposed for the UI's picker
// Run: node --test test/openstack-volumes.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PB_OPENSTACK_POLL_MS = '20';

const { SqliteDb } = await import('../dist/db/sqlite.js');
const { loadPlugins } = await import('../dist/plugins/runtime.js');
const { createApiServer } = await import('../dist/api/server.js');
const { default: openstackPlugin } = await import('../dist/plugins/openstack/index.js');
const { region, server, startFakeOpenStack } = await import('./fake-openstack.mjs');

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.openstack-volumes.sqlite');
const CLOUDS = '/api/plugins/openstack/clouds/';

let db, apiServer, base, os, cloudId, gra, vmId, vmId2, serverId;

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
const volumesUrl = (extra = '') => `${CLOUDS}${cloudId}/volumes/${extra}`;

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
    keypairs: [{ name: 'laptop', public_key: 'ssh-ed25519 AAAA laptop' }],
    images: [{ id: 'img-ubuntu', name: 'Ubuntu 24.04' }],
    servers: [server('srv-1', 'web'), server('srv-2', 'web2')],
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
  const vm = await until(
    () => db.get(`SELECT id FROM virtualization_virtual_machine WHERE name = 'web'`),
    'the VM to be imported by the first sync',
  );
  vmId = vm.id;
  serverId = 'srv-1';
  const vm2 = await until(
    () => db.get(`SELECT id FROM virtualization_virtual_machine WHERE name = 'web2'`),
    'the second VM to be imported',
  );
  vmId2 = vm2.id;
});
after(async () => {
  await new Promise((r) => apiServer.close(r));
  await os.close();
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('the volume types of a region are listed', async () => {
  const res = await api('GET', `${CLOUDS}${cloudId}/volume-types/?region=GRA9`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.results, [{ id: 'type-classic', name: 'classic' }]);
});

test('a create request is checked field by field', async () => {
  const bad = await api('POST', volumesUrl(), {});
  assert.equal(bad.status, 400);
  for (const f of ['region', 'name', 'size_gb']) assert.ok(bad.body[f], `${f} is reported`);
  assert.equal(
    (await api('POST', volumesUrl(), { region: 'GRA9', name: 'x', size_gb: 0 })).status,
    400,
  );
  assert.equal(gra.volumesCreated, undefined, 'nothing was created on the cloud');
});

test('a volume created with no VM is created on Cinder and mirrored right away, unattached', async () => {
  const res = await api('POST', volumesUrl(), { region: 'GRA9', name: 'standalone', size_gb: 10 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.id);
  const volume = await until(
    () => gra.volumes.find((v) => v.name === 'standalone'),
    'the volume to be created',
  );
  assert.equal(volume.size, 10);
  assert.equal(volume.status, 'available');
  assert.deepEqual(volume.attachments, []);
  const disk = await db.get(
    `SELECT id, virtual_machine_id FROM virtualization_virtual_disk WHERE name = 'standalone'`,
  );
  assert.equal(disk.id, res.body.id, 'the response already carries its id, no resync needed');
  assert.equal(disk.virtual_machine_id, null);
});

test('a volume type is sent through to Cinder', async () => {
  await api('POST', volumesUrl(), {
    region: 'GRA9',
    name: 'typed',
    size_gb: 5,
    volume_type: 'type-classic',
  });
  await until(() => gra.volumesCreated.some((v) => v.name === 'typed'), 'the create request');
  assert.equal(gra.volumesCreated.find((v) => v.name === 'typed').volume_type, 'type-classic');
});

test('a volume created with a VM is attached once available, and mirrored right away', async () => {
  const res = await api('POST', volumesUrl(), {
    region: 'GRA9',
    name: 'with-vm',
    size_gb: 15,
    virtual_machine_id: vmId,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // visible right away, VM already shown, no need to wait for the attach to finish
  const diskNow = await db.get(
    `SELECT id, virtual_machine_id, size FROM virtualization_virtual_disk WHERE name = 'with-vm'`,
  );
  assert.equal(diskNow.id, res.body.id);
  assert.equal(diskNow.virtual_machine_id, vmId);
  assert.equal(diskNow.size, 15);

  const volume = await until(
    () => gra.volumes.find((v) => v.name === 'with-vm'),
    'the volume to be created',
  );
  await until(() => volume.status === 'in-use', 'the volume to be attached');
  assert.deepEqual(gra.attached.at(-1), { server: serverId, volume: volume.id });
});

test('a bad VM is refused', async () => {
  const res = await api('POST', volumesUrl(), {
    region: 'GRA9',
    name: 'never',
    size_gb: 5,
    virtual_machine_id: 999999,
  });
  assert.equal(res.status, 400);
  assert.match(res.body.virtual_machine_id[0], /not a server of this cloud/);
});

test('an existing unattached volume can be attached to a VM, but not twice', async () => {
  const res = await api('POST', volumesUrl(), { region: 'GRA9', name: 'later', size_gb: 8 });
  assert.equal(res.status, 201);
  const volume = await until(
    () => gra.volumes.find((v) => v.name === 'later'),
    'the volume to be created',
  );

  const attach = await api('POST', volumesUrl(`${volume.id}/attach/`), {
    region: 'GRA9',
    virtual_machine_id: vmId,
  });
  assert.equal(attach.status, 202, JSON.stringify(attach.body));
  await until(() => volume.status === 'in-use', 'the volume to be attached');
  assert.deepEqual(gra.attached.at(-1), { server: serverId, volume: volume.id });
  await until(
    () => db.get(`SELECT id FROM virtualization_virtual_disk WHERE name = 'later'`),
    'it to be mirrored',
  );

  const again = await api('POST', volumesUrl(`${volume.id}/attach/`), {
    region: 'GRA9',
    virtual_machine_id: vmId,
  });
  assert.equal(again.status, 400);
  assert.match(again.body.volume_id[0], /already attached/);

  const missing = await api('POST', volumesUrl('vol-ghost/attach/'), {
    region: 'GRA9',
    virtual_machine_id: vmId,
  });
  assert.equal(missing.status, 404);
});

test('detaching keeps the volume by default, and its mirrored disk survives unattached', async () => {
  const volume = gra.volumes.find((v) => v.name === 'later');
  const res = await api('POST', volumesUrl(`${volume.id}/detach/`), {
    region: 'GRA9',
    virtual_machine_id: vmId,
  });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  await until(() => volume.status === 'available', 'the volume to be detached');
  assert.ok(
    gra.volumes.some((v) => v.id === volume.id),
    'the volume still exists',
  );
  await until(
    async () =>
      (
        await db.get(
          `SELECT virtual_machine_id FROM virtualization_virtual_disk WHERE name = 'later'`,
        )
      )?.virtual_machine_id === null,
    'its mirrored disk to survive, unattached',
  );
});

test('detaching with delete_volume also deletes it', async () => {
  const volume = gra.volumes.find((v) => v.name === 'with-vm');
  const res = await api('POST', volumesUrl(`${volume.id}/detach/`), {
    region: 'GRA9',
    virtual_machine_id: vmId,
    delete_volume: true,
  });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  await until(() => !gra.volumes.some((v) => v.id === volume.id), 'the volume to be deleted');
  assert.ok(gra.volumesDeleted.includes(volume.id));
});

test('an unattached volume can be deleted outright; an attached one refuses', async () => {
  const standalone = gra.volumes.find((v) => v.name === 'standalone');
  const gone = await api('DELETE', volumesUrl(`${standalone.id}/?region=GRA9`));
  assert.equal(gone.status, 204, JSON.stringify(gone.body));
  assert.ok(!gra.volumes.some((v) => v.id === standalone.id));

  // re-attach "later" to refuse deleting it while attached
  const later = gra.volumes.find((v) => v.name === 'later');
  await api('POST', volumesUrl(`${later.id}/attach/`), {
    region: 'GRA9',
    virtual_machine_id: vmId,
  });
  await until(() => later.status === 'in-use', 'it to be attached again');
  const refused = await api('DELETE', volumesUrl(`${later.id}/?region=GRA9`));
  assert.equal(refused.status, 400);
  assert.match(refused.body.volume_id[0], /detach it first/);

  const missingRegion = await api('DELETE', volumesUrl(`${later.id}/`));
  assert.equal(missingRegion.status, 400);
});

// ---- editing a mirrored Volume reconciles the cloud (the plugin's hook) -------------------

const VOLUMES = '/api/virtualization/virtual-disks/';
const diskOf = (name) => db.get(`SELECT * FROM virtualization_virtual_disk WHERE name = ?`, [name]);

test('a volume already on the cloud, never attached through paashup, is mirrored unattached by a sync', async () => {
  gra.volumes.push({
    id: 'vol-preexisting',
    name: 'preexisting',
    size: 7,
    status: 'available',
    attachments: [],
    reads: 0,
  });
  const res = await api('PATCH', `${CLOUDS}${cloudId}/`, { operation: 'refresh' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const disk = await until(() => diskOf('preexisting'), 'it to be mirrored by the sync');
  assert.equal(disk.virtual_machine_id, null);
  assert.equal(disk.size, 7);
});

test('attaching a mirrored volume by editing its VM calls OpenStack for real', async () => {
  const disk = await diskOf('preexisting');
  const res = await api('PATCH', `${VOLUMES}${disk.id}/`, { virtual_machine: vmId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const volume = gra.volumes.find((v) => v.name === 'preexisting');
  await until(() => volume.status === 'in-use', 'it to be attached on the cloud');
  assert.deepEqual(gra.attached.at(-1), { server: serverId, volume: volume.id });
});

test('reassigning a mirrored, attached volume to another VM detaches then reattaches it', async () => {
  const disk = await diskOf('preexisting');
  const volume = gra.volumes.find((v) => v.name === 'preexisting');
  const res = await api('PATCH', `${VOLUMES}${disk.id}/`, { virtual_machine: vmId2 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await until(
    () => gra.attached.at(-1)?.server === 'srv-2' && gra.attached.at(-1)?.volume === volume.id,
    'it to be reattached to the second VM',
  );
  assert.ok(!volume.attachments.some((a) => a.server_id === serverId), 'detached from the first');
});

test("clearing a mirrored volume's VM by editing it detaches it on the cloud, kept", async () => {
  const disk = await diskOf('preexisting');
  const volume = gra.volumes.find((v) => v.name === 'preexisting');
  const res = await api('PATCH', `${VOLUMES}${disk.id}/`, { virtual_machine: null });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await until(() => volume.status === 'available', 'it to be detached on the cloud');
  assert.ok(
    gra.volumes.some((v) => v.id === volume.id),
    'the volume still exists',
  );
  const after = await until(async () => {
    const d = await diskOf('preexisting');
    return d.virtual_machine_id === null ? d : null;
  }, 'the mirrored disk to show it unattached');
  assert.equal(after.virtual_machine_id, null);
});

test('growing a mirrored volume by editing its size resizes it on the cloud', async () => {
  const disk = await diskOf('preexisting');
  const res = await api('PATCH', `${VOLUMES}${disk.id}/`, { size: 20 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const volume = gra.volumes.find((v) => v.name === 'preexisting');
  await until(() => volume.size === 20, 'the resize to reach the cloud');
});

test('a resize OpenStack refuses (volume mid-transition, e.g. "reserved") reverts the size and journals why', async () => {
  // Cinder allows extending a settled volume (available or in-use), but refuses one still
  // mid-transition — e.g. "reserved" while an attach it was just asked for hasn't settled yet,
  // the exact race a resize requested in the same edit as an attach can hit.
  const disk = await diskOf('preexisting');
  const volume = gra.volumes.find((v) => v.name === 'preexisting');
  volume.status = 'reserved';

  const attemptedSize = volume.size + 5;
  const resize = await api('PATCH', `${VOLUMES}${disk.id}/`, { size: attemptedSize });
  assert.equal(resize.status, 200, JSON.stringify(resize.body));

  const reverted = await until(async () => {
    const d = await diskOf('preexisting');
    return d.size === volume.size ? d : null;
  }, 'its size to be reverted back to the real one');
  assert.equal(reverted.size, volume.size);
  assert.notEqual(volume.size, attemptedSize, 'the cloud never accepted the resize');

  const log = await until(async () => {
    const rows = await db.query(
      `SELECT comments FROM extras_journalentry
        WHERE assigned_object_type = 'virtualization.virtualdisk' AND assigned_object_id = ?`,
      [disk.id],
    );
    return rows.some((r) => r.comments.includes('Resize refused')) ? rows : null;
  }, "the disk's own journal to carry the refusal");
  assert.ok(log.some((e) => e.comments.includes('Resize refused by OpenStack')));
});

test("shrinking a mirrored volume by editing its size is reverted: OpenStack can't shrink one", async () => {
  const disk = await diskOf('preexisting');
  const volume = gra.volumes.find((v) => v.name === 'preexisting');
  assert.equal(volume.size, 20);
  const res = await api('PATCH', `${VOLUMES}${disk.id}/`, { size: 5 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const reverted = await until(async () => {
    const d = await diskOf('preexisting');
    return d.size === 20 ? d : null;
  }, 'its size to be reverted back to the real one');
  assert.equal(reverted.size, 20);

  const log = await until(async () => {
    const rows = await db.query(
      `SELECT comments FROM extras_journalentry
        WHERE assigned_object_type = 'virtualization.virtualdisk' AND assigned_object_id = ?`,
      [disk.id],
    );
    return rows.length ? rows : null;
  }, "the disk's own journal to carry the entry");
  assert.ok(
    log.some(
      (e) =>
        e.comments.includes('cannot be shrunk') ||
        e.comments.includes("can't shrink") ||
        e.comments.toLowerCase().includes('shrunk'),
    ),
  );
});

test('editing a plain (non-OpenStack) Volume never touches the cloud', async () => {
  const createdDisks = gra.volumesCreated?.length ?? 0;
  const res = await api('POST', VOLUMES, { virtual_machine: vmId, name: 'manual-disk', size: 1 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const edit = await api('PATCH', `${VOLUMES}${res.body.id}/`, { size: 2, virtual_machine: vmId2 });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(gra.volumesCreated?.length ?? 0, createdDisks, 'nothing was created on the cloud');
});

// ---- deleting a mirrored Volume really deletes it on the cloud too ------------------------

test('deleting a mirrored, attached Volume detaches then deletes it on the cloud', async () => {
  const create = await api('POST', volumesUrl(), {
    region: 'GRA9',
    name: 'to-be-deleted',
    size_gb: 4,
    virtual_machine_id: vmId,
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const diskId = create.body.id;
  const volume = await until(
    () => gra.volumes.find((v) => v.name === 'to-be-deleted'),
    'it to be created',
  );
  await until(() => volume.status === 'in-use', 'it to be attached');

  const res = await api('DELETE', `${VOLUMES}${diskId}/`);
  assert.equal(res.status, 204, JSON.stringify(res.body));
  assert.ok(!gra.volumes.some((v) => v.id === volume.id), 'deleted for real on the cloud');
  assert.equal(await diskOf('to-be-deleted'), undefined, 'and its paashup record is gone');
});

test('deleting a mirrored Volume the cloud refuses to delete aborts: record and volume both survive', async () => {
  const create = await api('POST', volumesUrl(), { region: 'GRA9', name: 'stubborn', size_gb: 3 });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const diskId = create.body.id;
  const volume = await until(() => gra.volumes.find((v) => v.name === 'stubborn'), 'it to exist');

  gra.volumesDown = true;
  const res = await api('DELETE', `${VOLUMES}${diskId}/`);
  assert.equal(res.status, 500, JSON.stringify(res.body));
  gra.volumesDown = false;

  assert.ok(
    gra.volumes.some((v) => v.id === volume.id),
    'the volume was not deleted',
  );
  assert.ok(await diskOf('stubborn'), 'and its paashup record was not deleted either');
});
