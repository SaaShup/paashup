// Creating and deleting VMs on OpenStack from paasbox, end to end against the fake cloud
// (test/fake-openstack.mjs). Verifies:
//   - a create request is validated (fields, flavor, region, key) and the project's quotas
//     are checked, all with readable errors and nothing created on the cloud
//   - a server is booted from the image with the networks / key / groups chosen and the
//     `managed-by` stamp; the VM is imported as managed, follows the server to active (or
//     failed), and its journal keeps the SSH key it was launched with, in full
//   - an SSH key of paasbox missing from the region is uploaded first; a keypair of that name
//     with another key, or a key name Nova refuses, is an error — never renamed
//   - only VMs paasbox created can be deleted on OpenStack: managed → deleted on the cloud and
//     removed here; imported → refused (403); unknown → 404
// Run: node --test test/openstack-vm.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PB_OPENSTACK_POLL_MS = '20'; // read when the plugin loads: follow servers fast

const { SqliteDb } = await import('../dist/db/sqlite.js');
const { loadPlugins } = await import('../dist/plugins/runtime.js');
const { createApiServer } = await import('../dist/api/server.js');
const { default: openstackPlugin } = await import('../dist/plugins/openstack/index.js');
const { region, server, startFakeOpenStack } = await import('./fake-openstack.mjs');

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.openstack-vm.sqlite');
const CLOUDS = '/api/plugins/openstack/clouds/';
const SERVERS = '/api/plugins/openstack/servers/';
const KEYS = '/api/virtualization/ssh-keys/';
const VM_TYPE = 'virtualization.virtualmachine';

const ED25519 =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@host';
const RSA = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDhA alice@host';

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
    `SELECT v.id, v.status, s.managed, s.server_id FROM virtualization_virtual_machine v
       JOIN plugin_openstack_server s ON s.virtual_machine_id = v.id WHERE v.name = ?`,
    [name],
  );
const statusOf = async (id) =>
  (await db.get('SELECT status FROM virtualization_virtual_machine WHERE id = ?', [id]))?.status;
const journalOf = async (vmId) =>
  (
    await db.query(
      `SELECT kind, comments FROM extras_journalentry
        WHERE assigned_object_type = ? AND assigned_object_id = ? ORDER BY id`,
      [VM_TYPE, vmId],
    )
  ).map((r) => ({ ...r }));
// how many full synchronizations the cloud has run (each leaves a "Synchronized" entry)
const syncRuns = async () =>
  (
    await db.get(
      `SELECT COUNT(*) n FROM extras_journalentry
        WHERE assigned_object_type = 'plugins.openstackcloud' AND assigned_object_id = ?
          AND comments LIKE 'Synchronized%'`,
      [cloudId],
    )
  ).n;
const good = (extra = {}) => ({
  region: 'GRA9',
  name: 'web',
  flavor_id: 'fl-1',
  image_id: 'img-ubuntu',
  network_ids: ['net-ext'],
  ssh_key: { source: 'cloud', name: 'laptop' },
  ...extra,
});
const create = (extra) => api('POST', `${CLOUDS}${cloudId}/servers/`, good(extra));

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
    keypairs: [{ name: 'laptop', public_key: ED25519 }],
    images: [{ id: 'img-ubuntu', name: 'Ubuntu 24.04' }],
    servers: [server('legacy-1', 'legacy')], // there before paasbox: not managed
    buildReads: 2,
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
  await until(async () => (await vmNamed('legacy'))?.id, 'the first sync');
});
after(async () => {
  await new Promise((r) => apiServer.close(r));
  await os.close();
  await db.close();
  rmSync(DB_FILE, { force: true });
});

// ---- validation -------------------------------------------------------------------------

test('a create request is checked field by field', async () => {
  const empty = await api('POST', `${CLOUDS}${cloudId}/servers/`, {});
  assert.equal(empty.status, 400);
  for (const f of ['name', 'region', 'flavor_id', 'image_id', 'network_ids', 'ssh_key']) {
    assert.ok(empty.body[f], `${f} is reported`);
  }
  assert.equal((await create({ name: 'x'.repeat(65) })).status, 400);
  assert.equal((await create({ network_ids: [] })).status, 400);
  assert.equal((await create({ flavor_id: 'nope' })).body.flavor_id.length, 1);
  assert.equal((await create({ region: 'MARS1' })).body.region.length, 1);
  assert.match(
    (await create({ ssh_key: { source: 'cloud', name: 'ghost' } })).body.ssh_key[0],
    /No SSH keypair named "ghost"/,
  );
  assert.equal((await api('POST', `${CLOUDS}99999/servers/`, good())).status, 404, 'unknown cloud');
  assert.equal(gra.created, undefined, 'nothing was created on the cloud');
});

test('a project out of quota is refused with a readable message', async () => {
  const limits = gra.limits;
  const refuse = async (patch, expected) => {
    Object.assign(limits, patch);
    const res = await create({ name: 'too-much' });
    assert.equal(res.status, 400);
    assert.match(res.body.detail, expected);
    Object.assign(limits, { totalInstancesUsed: 0, totalCoresUsed: 0, totalRAMUsed: 0 });
  };
  await refuse({ totalInstancesUsed: 10 }, /no instance left \(10 used of 10\)/);
  await refuse({ totalCoresUsed: 19 }, /not enough vCPUs/);
  await refuse({ totalRAMUsed: 50000 }, /not enough memory/);
  assert.equal(gra.created, undefined);
});

// ---- create -----------------------------------------------------------------------------

test('a VM is booted with what was chosen, imported as managed and journaled with its key', async () => {
  const syncsBefore = await syncRuns();
  const res = await create({
    name: 'web-1',
    network_ids: ['net-ext', 'net-priv'],
    security_groups: ['default', 'ssh'],
  });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.equal(res.body.ssh_key, 'laptop');

  const spec = gra.created.at(-1);
  assert.equal(spec.name, 'web-1');
  assert.equal(spec.flavorRef, 'fl-1');
  assert.equal(spec.imageRef, 'img-ubuntu');
  assert.equal(spec.key_name, 'laptop');
  assert.deepEqual(spec.networks, [{ uuid: 'net-ext' }, { uuid: 'net-priv' }]);
  assert.deepEqual(spec.security_groups, [{ name: 'default' }, { name: 'ssh' }]);
  assert.deepEqual(spec.metadata, { 'managed-by': 'paasbox' });

  // the VM exists as soon as the request is answered, still building
  const right = await vmNamed('web-1');
  assert.equal(res.body.vm_id, right.id);
  assert.equal(right.status, 'planned');
  const vm = await until(() => vmNamed('web-1'), 'the VM to be imported');
  assert.equal(!!vm.managed, true);
  assert.equal(vm.server_id, res.body.server_id);
  await until(async () => (await statusOf(vm.id)) === 'active', 'the VM to be active');

  // only this server was read: no full synchronization, nothing else touched
  assert.equal(await syncRuns(), syncsBefore, 'no full sync ran');
  assert.ok(await vmNamed('legacy'), 'the other VMs are left alone');
  assert.equal(
    (
      await db.get(
        `SELECT i.name FROM virtualization_virtual_machine v
         JOIN virtualization_image i ON i.id = v.image_id WHERE v.id = ?`,
        [vm.id],
      )
    )?.name,
    'Ubuntu 24.04',
    'the VM is linked to its image',
  );

  assert.ok(
    (
      await db.get(`SELECT primary_ip4_id AS ip FROM virtualization_virtual_machine WHERE id = ?`, [
        vm.id,
      ])
    ).ip,
    'the address it got once active is imported',
  );

  const log = await journalOf(vm.id);
  assert.equal(log[0].kind, 'info');
  assert.ok(log[0].comments.includes('with SSH key "laptop"'));
  assert.ok(log[0].comments.includes(ED25519), 'the public key is in the journal, in full');
  assert.equal(log.at(-1).kind, 'success');
});

test('the security groups are optional', async () => {
  assert.equal((await create({ name: 'web-nogroup' })).status, 202);
  assert.equal(gra.created.at(-1).security_groups, undefined);
  const vm = await until(() => vmNamed('web-nogroup'), 'the VM');
  await until(async () => (await statusOf(vm.id)) === 'active', 'the VM to be active');
});

test('a server that fails to build leaves the VM failed, with the reason in its journal', async () => {
  gra.failBuild = 'No valid host was found';
  const res = await create({ name: 'doomed' });
  assert.equal(res.status, 202);
  const vm = await until(() => vmNamed('doomed'), 'the VM to be imported');
  await until(async () => (await statusOf(vm.id)) === 'failed', 'the VM to be failed');
  const log = await journalOf(vm.id);
  assert.ok(log.some((e) => e.kind === 'danger' && e.comments.includes('No valid host was found')));
  gra.failBuild = null;
});

// ---- SSH keys ---------------------------------------------------------------------------

test('a paasbox key missing from the region is uploaded, then reused', async () => {
  const key = (await api('POST', KEYS, { name: 'alice key', public_key: RSA })).body;
  const before = gra.keypairs.length;
  const first = await create({ name: 'with-alice', ssh_key: { source: 'paasbox', id: key.id } });
  assert.equal(first.status, 202, JSON.stringify(first.body));
  assert.equal(gra.keypairs.length, before + 1);
  assert.deepEqual(
    gra.keypairs.find((k) => k.name === 'alice key'),
    { name: 'alice key', public_key: RSA },
  );
  assert.equal(gra.created.at(-1).key_name, 'alice key');
  const vm = await until(() => vmNamed('with-alice'), 'the VM');
  await until(async () => (await journalOf(vm.id))[0], 'its journal');
  assert.ok((await journalOf(vm.id))[0].comments.includes(RSA));

  // already there with the same key: used as is, not uploaded again
  const second = await create({ name: 'with-alice-2', ssh_key: { source: 'paasbox', id: key.id } });
  assert.equal(second.status, 202);
  assert.equal(gra.keypairs.length, before + 1);
});

test('a keypair of that name holding another key is an error; nothing is renamed or created', async () => {
  const key = (await api('POST', KEYS, { name: 'clash', public_key: RSA.replace('DhA', 'DhB') }))
    .body;
  gra.keypairs.push({ name: 'clash', public_key: ED25519 });
  const created = gra.created.length;
  const res = await create({ name: 'never', ssh_key: { source: 'paasbox', id: key.id } });
  assert.equal(res.status, 400);
  assert.match(res.body.ssh_key[0], /"clash" already exists in region GRA9 with a different/);
  assert.equal(gra.created.length, created);
  assert.equal(gra.keypairs.filter((k) => k.name === 'clash').length, 1, 'no keypair was added');
});

test('a key name Nova refuses cannot be used, and is not adapted', async () => {
  // keys imported from a cloud on a recent Nova can carry "@" or "."
  const id = (
    await db.execute(
      `INSERT INTO virtualization_ssh_key (name, public_key) VALUES ('ana@example.com', ?)`,
      [RSA.replace('DhA', 'DhC')],
    )
  ).insertId;
  const keypairs = gra.keypairs.length;
  const res = await create({ name: 'never-2', ssh_key: { source: 'paasbox', id } });
  assert.equal(res.status, 400);
  assert.match(
    res.body.ssh_key[0],
    /"ana@example.com" cannot be used as an OpenStack keypair name/,
  );
  assert.equal(gra.keypairs.length, keypairs);
  assert.equal(
    (await create({ name: 'never-3', ssh_key: { source: 'paasbox', id: 99999 } })).body.ssh_key[0],
    'This SSH key does not exist.',
  );
});

// ---- delete -----------------------------------------------------------------------------

test('the changes of a VM are broadcast as it is built, journaled and removed', async () => {
  const events = [];
  const ws = new WebSocket(`ws://127.0.0.1:${apiServer.address().port}/api/ws/`);
  ws.addEventListener('message', (e) => events.push(JSON.parse(e.data)));
  await new Promise((r) => ws.addEventListener('open', r));
  const mine = (vmId, event) =>
    events.filter(
      (e) =>
        e.type === 'change' &&
        e.table === 'virtualization_virtual_machine' &&
        e.id === vmId &&
        (!event || e.event === event),
    );

  const res = await create({ name: 'live' });
  assert.equal(res.status, 202);
  const vmId = res.body.vm_id;
  await until(() => mine(vmId, 'created').length, 'the created event');
  assert.equal(mine(vmId, 'created')[0].data.status.value, 'planned');

  await until(() => mine(vmId, 'updated').some((e) => e.data.status.value === 'active'), 'active');
  assert.ok(
    mine(vmId, 'updated').some((e) => e.data.primary_ip4),
    'the address it got is broadcast',
  );

  assert.equal((await api('DELETE', `${SERVERS}${vmId}/`)).status, 202);
  await until(() => mine(vmId, 'deleted').length, 'the deleted event');
  assert.equal(mine(vmId, 'deleted')[0].data, undefined);
  ws.close();
});

test('the servers behind the VMs tell managed from imported', async () => {
  const web = await vmNamed('web-1');
  const legacy = await vmNamed('legacy');
  const one = await api('GET', `${SERVERS}?virtual_machine_id=${web.id}`);
  assert.equal(one.body.count, 1);
  assert.deepEqual(
    { managed: one.body.results[0].managed, cloud: one.body.results[0].cloud },
    { managed: true, cloud: 'ovh' },
  );
  const all = (await api('GET', SERVERS)).body.results;
  assert.equal(all.find((r) => r.virtual_machine_id === legacy.id).managed, false);
});

test('a VM paasbox created is deleted on OpenStack and then removed here', async () => {
  const vm = await vmNamed('web-nogroup');
  const res = await api('DELETE', `${SERVERS}${vm.id}/`);
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.deepEqual(gra.deleted.at(-1), vm.server_id);
  await until(async () => !(await vmNamed('web-nogroup')), 'the VM to be removed');
  assert.ok(!gra.servers.some((s) => s.id === vm.server_id));
  assert.ok(await vmNamed('web-1'), 'the other VMs are left alone');
  assert.ok(await vmNamed('legacy'));
});

test('a VM that existed before paasbox cannot be deleted from here', async () => {
  const legacy = await vmNamed('legacy');
  const deleted = (gra.deleted ?? []).length;
  const res = await api('DELETE', `${SERVERS}${legacy.id}/`);
  assert.equal(res.status, 403);
  assert.match(res.body.detail, /Only VMs created by paasbox/);
  assert.equal((gra.deleted ?? []).length, deleted, 'nothing was deleted on the cloud');
  assert.equal(await statusOf(legacy.id), 'active');
});

test('a VM with no OpenStack server behind it is a 404', async () => {
  const id = (
    await api('POST', '/api/virtualization/virtual-machines/', { name: 'plain', status: 'active' })
  ).body.id;
  assert.equal((await api('DELETE', `${SERVERS}${id}/`)).status, 404);
  assert.equal((await api('DELETE', `${SERVERS}99999/`)).status, 404);
});

test('the cloud journal keeps what was requested and done', async () => {
  const entries = async () =>
    (
      await db.query(
        `SELECT comments FROM extras_journalentry WHERE assigned_object_type = 'plugins.openstackcloud'
          AND assigned_object_id = ?`,
        [cloudId],
      )
    ).map((r) => r.comments);
  // the "deleted" entry is written once the server is gone and the VM removed
  const log = await until(async () => {
    const all = await entries();
    return all.some((c) => c.includes('Server "web-nogroup" deleted in GRA9')) ? all : null;
  }, 'the deletion to be journaled');
  assert.ok(log.some((c) => c.includes('Server "web-1" requested in GRA9')));
  assert.ok(log.some((c) => c.includes('Deletion of server "web-nogroup" requested')));
});

// ---- init scripts -----------------------------------------------------------------------

const SCRIPTS = '/api/virtualization/init-scripts/';
const SCRIPT =
  '#!/bin/bash\nset -e\nDOMAIN="${DOMAIN:-example.org}"\nTOKEN="${TOKEN:-}"\nPORT="${PORT:-80}"\n';
const userData = (spec) => Buffer.from(spec.user_data, 'base64').toString();
const addScript = async (extra = {}) =>
  (await api('POST', SCRIPTS, { name: `script-${Math.random()}`, content: SCRIPT, ...extra })).body;
const scriptNotes = async (vmId) =>
  (await journalOf(vmId)).map((e) => e.comments).filter((c) => c.startsWith('Init script'));

test('the init script is sent as the server user_data, with the changed variables exported', async () => {
  const s = await addScript();
  const res = await create({
    name: 'with-script',
    init_script: { id: s.id, variables: { DOMAIN: 'my.io', PORT: '80' } },
  });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.equal(
    userData(gra.created.at(-1)),
    `#!/bin/bash\nexport DOMAIN='my.io'\n${SCRIPT.slice('#!/bin/bash\n'.length)}`,
    'the script as it is, plus the one value that differs from its default',
  );
  const vm = await until(() => vmNamed('with-script'), 'the VM');
  await until(async () => (await scriptNotes(vm.id)).length, 'the script in the journal');
  assert.deepEqual(await scriptNotes(vm.id), ['Init script "' + s.name + '" with DOMAIN="my.io".']);
  await until(async () => (await statusOf(vm.id)) === 'active', 'the VM to be active');
});

test('a VM launched without a script, or with the defaults, says so', async () => {
  assert.equal((await create({ name: 'no-script' })).status, 202);
  assert.equal(gra.created.at(-1).user_data, undefined, 'no user_data without a script');
  const vm = await until(() => vmNamed('no-script'), 'the VM');
  assert.deepEqual(await scriptNotes(vm.id), []);

  const s = await addScript();
  const res = await create({ name: 'default-script', init_script: { id: s.id, variables: {} } });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.equal(userData(gra.created.at(-1)), SCRIPT, 'nothing exported');
  const dvm = await until(() => vmNamed('default-script'), 'the VM');
  await until(async () => (await scriptNotes(dvm.id)).length, 'the script in the journal');
  assert.match((await scriptNotes(dvm.id))[0], /with its default values\.$/);
});

test('a secret variable is masked in the journals, the others are written out', async () => {
  const s = await addScript({ secret_variables: ['TOKEN'] });
  const res = await create({
    name: 'with-secret',
    init_script: { id: s.id, variables: { DOMAIN: 'my.io', TOKEN: 'hunter2' } },
  });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.ok(userData(gra.created.at(-1)).includes("export TOKEN='hunter2'"), 'the VM gets it');
  const vm = await until(() => vmNamed('with-secret'), 'the VM');
  await until(async () => (await statusOf(vm.id)) === 'active', 'the VM to be active');
  assert.deepEqual(await scriptNotes(vm.id), [
    `Init script "${s.name}" with DOMAIN="my.io", TOKEN=***.`,
  ]);
  const everything = await db.query(`SELECT comments FROM extras_journalentry`);
  assert.ok(!everything.some((e) => e.comments.includes('hunter2')), 'no journal holds the secret');
});

test('a script saved before secrets existed (no secret list) still launches a VM', async () => {
  const s = await addScript();
  await db.execute(`UPDATE virtualization_init_script SET secret_variables = NULL WHERE id = ?`, [
    s.id,
  ]);
  const res = await create({
    name: 'old-script',
    init_script: { id: s.id, variables: { PORT: '8080' } },
  });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.ok(userData(gra.created.at(-1)).includes("export PORT='8080'"));
});

test('a bad init script is refused before anything is created or uploaded', async () => {
  const s = await addScript();
  const key = (
    await api('POST', KEYS, { name: 'not in region', public_key: RSA.replace('DhA', 'DhD') })
  ).body;
  const created = gra.created.length;
  const keypairs = gra.keypairs.length;
  const refused = async (init_script, expected) => {
    const res = await create({
      name: 'never-script',
      ssh_key: { source: 'paasbox', id: key.id },
      init_script,
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.init_script[0], expected);
  };
  await refused({ id: 99999, variables: {} }, /does not exist/);
  await refused({ id: s.id, variables: { NOPE: '1' } }, /no variable "NOPE"/);
  await refused({ id: s.id, variables: { DOMAIN: 'x'.repeat(60000) } }, /too large/);
  await refused({ id: 'abc' }, /Choose an init script/);
  await refused({ id: s.id, variables: [] }, /object of name/);
  assert.equal(gra.created.length, created, 'nothing was created on the cloud');
  assert.equal(gra.keypairs.length, keypairs, 'the key was not uploaded');
});

// ---- metadata ---------------------------------------------------------------------------

const metaUrl = (vmId) => `${SERVERS}${vmId}/metadata/`;
const storedMeta = async (vmId) =>
  JSON.parse(
    (
      await db.get(`SELECT metadata FROM plugin_openstack_server WHERE virtual_machine_id = ?`, [
        vmId,
      ])
    ).metadata,
  );
const novaMeta = (serverId) => gra.servers.find((s) => s.id === serverId).metadata;
const metaNotes = async (vmId) =>
  (await journalOf(vmId)).map((e) => e.comments).filter((c) => c.startsWith('Metadata'));

test('the metadata of a request go to the server, next to the one paasbox adds', async () => {
  const res = await create({ name: 'tagged', metadata: { env: 'prod', owner: 'ana' } });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.deepEqual(gra.created.at(-1).metadata, {
    env: 'prod',
    owner: 'ana',
    'managed-by': 'paasbox',
  });
  const vm = await until(() => vmNamed('tagged'), 'the VM');
  await until(async () => (await metaNotes(vm.id)).length, 'the metadata in the journal');
  assert.deepEqual(await metaNotes(vm.id), ['Metadata set: env, owner.'], 'names only, no values');
  assert.deepEqual(await storedMeta(vm.id), { env: 'prod', owner: 'ana', 'managed-by': 'paasbox' });
  await until(async () => (await statusOf(vm.id)) === 'active', 'the VM to be active');
});

test('a request without metadata still carries managed-by', async () => {
  assert.equal((await create({ name: 'untagged' })).status, 202);
  assert.deepEqual(gra.created.at(-1).metadata, { 'managed-by': 'paasbox' });
  const vm = await until(() => vmNamed('untagged'), 'the VM');
  assert.deepEqual(await metaNotes(vm.id), []);
});

test('bad metadata is refused before anything is created', async () => {
  const created = gra.created.length;
  const refused = async (metadata, expected) => {
    const res = await create({ name: 'never-meta', metadata });
    assert.equal(res.status, 400, JSON.stringify(metadata));
    assert.match(res.body.metadata[0], expected);
  };
  await refused({ 'managed-by': 'x' }, /set by paasbox/);
  await refused(['a'], /object of key/);
  await refused({ ' env': 'x' }, /cannot be empty or start or end with a space/);
  await refused({ '': 'x' }, /cannot be empty/);
  await refused({ ['k'.repeat(256)]: 'x' }, /longer than 255/);
  await refused({ env: 'v'.repeat(256) }, /longer than 255/);
  await refused({ env: { nested: 1 } }, /must be text/);
  await refused(
    Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 'v'])),
    /At most 100/,
  );
  assert.equal(gra.created.length, created, 'nothing was created on the cloud');
});

test('numbers and booleans are kept as text, and a null value is empty text', async () => {
  assert.equal((await create({ name: 'typed', metadata: { n: 5, b: true, z: null } })).status, 202);
  assert.deepEqual(gra.created.at(-1).metadata, {
    n: '5',
    b: 'true',
    z: '',
    'managed-by': 'paasbox',
  });
});

test('the metadata of a VM are read from what was stored, with the key paasbox keeps', async () => {
  const vm = await vmNamed('tagged');
  const res = await api('GET', metaUrl(vm.id));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.metadata, { env: 'prod', owner: 'ana', 'managed-by': 'paasbox' });
  assert.deepEqual(res.body.reserved, ['managed-by']);

  // not read from the cloud each time: a change made there waits for the next import
  novaMeta(vm.server_id).env = 'changed-in-nova';
  assert.equal((await api('GET', metaUrl(vm.id))).body.metadata.env, 'prod');

  const legacy = await vmNamed('legacy');
  assert.deepEqual((await api('GET', metaUrl(legacy.id))).body.metadata, {});
  const listed = (await api('GET', `${SERVERS}?virtual_machine_id=${vm.id}`)).body.results[0];
  assert.equal(listed.metadata.env, 'prod', 'the servers list carries them too');
  novaMeta(vm.server_id).env = 'prod';
});

test('editing sets, updates and deletes keys on the server, and stores the result', async () => {
  const vm = await vmNamed('tagged');
  const res = await api('PUT', metaUrl(vm.id), { metadata: { env: 'staging', cost: '42' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // owner was left out: deleted; managed-by is never touched
  assert.deepEqual(novaMeta(vm.server_id), { env: 'staging', cost: '42', 'managed-by': 'paasbox' });
  assert.deepEqual(res.body.metadata, novaMeta(vm.server_id));
  assert.deepEqual(await storedMeta(vm.id), novaMeta(vm.server_id));
  assert.deepEqual((await api('GET', metaUrl(vm.id))).body.metadata, novaMeta(vm.server_id));
  assert.deepEqual(
    (await metaNotes(vm.id)).at(-1),
    'Metadata updated: set env, cost; removed owner.',
  );
  const everything = (await db.query(`SELECT comments FROM extras_journalentry`)).map(
    (e) => e.comments,
  );
  assert.ok(!everything.some((c) => c.includes('staging')), 'no value is written to a journal');
});

test('sending the same metadata again changes nothing and journals nothing', async () => {
  const vm = await vmNamed('tagged');
  const notes = (await metaNotes(vm.id)).length;
  const res = await api('PUT', metaUrl(vm.id), { metadata: { env: 'staging', cost: '42' } });
  assert.equal(res.status, 200);
  assert.equal((await metaNotes(vm.id)).length, notes);
});

test('managed-by cannot be changed, and may be sent back as it is', async () => {
  const vm = await vmNamed('tagged');
  const refused = await api('PUT', metaUrl(vm.id), { metadata: { 'managed-by': 'someone' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.metadata[0], /set by paasbox/);
  assert.equal(novaMeta(vm.server_id)['managed-by'], 'paasbox');

  const same = await api('PUT', metaUrl(vm.id), {
    metadata: { env: 'staging', cost: '42', 'managed-by': 'paasbox' },
  });
  assert.equal(same.status, 200, JSON.stringify(same.body));

  // an empty list removes every key but managed-by
  const emptied = await api('PUT', metaUrl(vm.id), { metadata: {} });
  assert.equal(emptied.status, 200);
  assert.deepEqual(novaMeta(vm.server_id), { 'managed-by': 'paasbox' });
  assert.equal(
    (await api('PUT', metaUrl(vm.id), {})).status,
    200,
    'a missing list is an empty one',
  );
});

test('bad metadata in an edit is refused and nothing is changed on the server', async () => {
  const vm = await vmNamed('tagged');
  await api('PUT', metaUrl(vm.id), { metadata: { keep: 'me' } });
  const refused = await api('PUT', metaUrl(vm.id), { metadata: { keep: 'v'.repeat(256) } });
  assert.equal(refused.status, 400);
  assert.deepEqual(novaMeta(vm.server_id), { keep: 'me', 'managed-by': 'paasbox' });
});

test('the metadata of a VM imported from the cloud can be edited too', async () => {
  const legacy = await vmNamed('legacy');
  const res = await api('PUT', metaUrl(legacy.id), { metadata: { team: 'ops' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(novaMeta(legacy.server_id), { team: 'ops' });
  assert.deepEqual(res.body.metadata, { team: 'ops' });
  assert.equal(!!(await vmNamed('legacy')).managed, false, 'it does not become a managed VM');
});
