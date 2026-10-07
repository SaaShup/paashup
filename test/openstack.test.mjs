// OpenStack plugin, end to end against a fake OpenStack (test/fake-openstack.mjs — Keystone,
// Nova, Glance and Cinder on one local HTTP server, no real cloud needed). Verifies:
//   - saving a cloud tests the credentials first; a wrong password is rejected, nothing
//     is stored, and the password never reaches the journal or an error message
//   - the sync mirrors regions → DCIM regions / sites / clusters, servers → VMs (+ interfaces,
//     IPs, disks), flavors → VM types (matched by name), images → images, keypairs → SSH keys
//   - a later sync updates in place: renames, removals, duplicate VM names
//   - several clouds share what they have in common (one image row, one VM type) and
//     deleting a cloud removes only what it imported
// Run: node --test test/openstack.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { createApiServer } from '../dist/api/server.js';
import openstackPlugin from '../dist/plugins/openstack/index.js';
import { addr, region, server, startFakeOpenStack } from './fake-openstack.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.openstack.sqlite');
const CLOUDS = '/api/plugins/openstack/clouds/';
const CLOUD_TYPE = 'plugins.openstackcloud';

const ED25519 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const RSA = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDhA';

let db, apiServer, base, os;

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

const journalCount = async (id) =>
  (
    await db.get(
      `SELECT COUNT(*) n FROM extras_journalentry WHERE assigned_object_type = ? AND assigned_object_id = ?`,
      [CLOUD_TYPE, id],
    )
  ).n;

/** Wait until the cloud is no longer syncing and a new journal entry was written. */
async function waitSync(id, journalBefore) {
  for (let i = 0; i < 200; i++) {
    const row = await db.get('SELECT state FROM plugin_openstack_cloud WHERE id = ?', [id]);
    if (
      (row.state === 'connected' || row.state === 'error') &&
      (await journalCount(id)) > journalBefore
    ) {
      return row.state;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('sync did not finish');
}

async function createCloud(name, extra = {}) {
  const res = await api('POST', CLOUDS, {
    name,
    auth_url: os.authUrl,
    username: os.state.user,
    password: os.state.password,
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await waitSync(res.body.id, 1); // 1 = the "connection verified" entry written on save
  return res.body;
}

async function resync(id) {
  const before = await journalCount(id);
  const res = await api('PATCH', `${CLOUDS}${id}/`, { operation: 'refresh' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return waitSync(id, before);
}

// rows come back without a prototype: copy them so deepStrictEqual can compare
const all = async (sql, params) => (await db.query(sql, params)).map((r) => ({ ...r }));
const names = async (sql, params) => (await all(sql, params)).map((r) => r.name).sort();

before(async () => {
  os = await startFakeOpenStack();
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0008_journalentry.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [openstackPlugin]);
  apiServer = createApiServer({ db });
  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${apiServer.address().port}`;

  // What the fake cloud holds: GRA9 has two servers (one on an image, one booted from a
  // volume), a data volume and two keypairs; SBG5 has one server.
  os.state.regions = {
    GRA9: region({
      images: [{ id: 'img-ubuntu', name: 'Ubuntu 24.04' }],
      servers: [
        server('s-a', 'web', {
          addresses: {
            'Ext-Net': [addr('10.0.0.5'), addr('51.1.1.1', { 'OS-EXT-IPS:type': 'floating' })],
          },
        }),
        server('s-b', 'worker', {
          image: '',
          flavor: { original_name: 'c2-15', vcpus: 4, ram: 15360, disk: 100 },
        }),
      ],
      volumes: [
        {
          id: 'vol-1',
          name: 'data',
          size: 100,
          status: 'in-use',
          attachments: [{ server_id: 's-a', device: '/dev/vdb' }],
        },
        { id: 'vol-2', name: 'spare', size: 10, status: 'available', attachments: [] },
      ],
      keypairs: [
        { name: 'laptop', public_key: ED25519 },
        { name: 'win', public_key: '', type: 'x509' },
      ],
    }),
    SBG5: region({
      images: [{ id: 'img-ubuntu', name: 'Ubuntu 24.04' }],
      servers: [server('s-d', 'db')],
      keypairs: [{ name: 'laptop', public_key: ED25519 }],
    }),
  };
});
after(async () => {
  await new Promise((r) => apiServer.close(r));
  await os.close();
  await db.close();
  rmSync(DB_FILE, { force: true });
});

// ---- connection test on save -----------------------------------------------------------

test('a wrong password is rejected and nothing is saved', async () => {
  const res = await api('POST', CLOUDS, {
    name: 'bad',
    auth_url: os.authUrl,
    username: os.state.user,
    password: 'not-the-password',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.detail, /Keystone authentication failed/);
  assert.equal((await api('GET', CLOUDS)).body.count, 0);
  assert.ok(!JSON.stringify(res.body).includes('not-the-password'));
});

test('a user without a default project is rejected', async () => {
  os.state.hasProject = false;
  const res = await api('POST', CLOUDS, {
    name: 'noproj',
    auth_url: os.authUrl,
    username: os.state.user,
    password: os.state.password,
  });
  os.state.hasProject = true;
  assert.equal(res.status, 400);
  assert.match(res.body.detail, /no default project/);
});

test('missing fields are reported per field', async () => {
  const res = await api('POST', CLOUDS, { name: 'x' });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.body).sort(), ['auth_url', 'password', 'username']);
});

// ---- first import ----------------------------------------------------------------------

let ovh;

test('creating a cloud imports its regions, VMs, types, images, disks and keys', async () => {
  ovh = await createCloud('ovh');
  assert.equal(ovh.project_name, 'demo-project'); // the user's default project, filled in
  const cloud = await db.get('SELECT state, error FROM plugin_openstack_cloud WHERE id = ?', [
    ovh.id,
  ]);
  assert.equal(cloud.state, 'connected');
  assert.equal(cloud.error, null);

  // one DCIM region + site + cluster per OpenStack region, the cluster scoped to its site
  assert.deepEqual(await names('SELECT name FROM dcim_region'), ['GRA9', 'SBG5']);
  assert.deepEqual(await names('SELECT name FROM dcim_site'), ['ovh (GRA9)', 'ovh (SBG5)']);
  const clusters = await all(
    `SELECT c.name, s.name AS site FROM virtualization_cluster c
       JOIN dcim_site s ON c.scope_type = 'dcim.site' AND c.scope_id = s.id ORDER BY c.name`,
  );
  assert.deepEqual(clusters, [
    { name: 'ovh (GRA9)', site: 'ovh (GRA9)' },
    { name: 'ovh (SBG5)', site: 'ovh (SBG5)' },
  ]);

  // servers → VMs, each on its region's cluster and site
  const vms = await all(
    `SELECT v.name, c.name AS cluster, s.name AS site, v.vcpus, v.memory, v.status
       FROM virtualization_virtual_machine v
       JOIN virtualization_cluster c ON c.id = v.cluster_id
       JOIN dcim_site s ON s.id = v.site_id ORDER BY v.name`,
  );
  assert.deepEqual(
    vms.map((v) => [v.name, v.cluster, v.site, v.vcpus, v.memory, v.status]),
    [
      ['db', 'ovh (SBG5)', 'ovh (SBG5)', 2, 7168, 'active'],
      ['web', 'ovh (GRA9)', 'ovh (GRA9)', 2, 7168, 'active'],
      ['worker', 'ovh (GRA9)', 'ovh (GRA9)', 4, 15360, 'active'],
    ],
  );

  // flavors → VM types by name, once each, only those in use
  assert.deepEqual(await names('SELECT name FROM virtualization_virtual_machine_type'), [
    'b2-7',
    'c2-15',
  ]);
});

test('images are linked by name; a VM booted from a volume has none', async () => {
  assert.deepEqual(await names('SELECT name FROM virtualization_image'), ['Ubuntu 24.04']);
  const rows = await all(
    `SELECT v.name, i.name AS image FROM virtualization_virtual_machine v
       LEFT JOIN virtualization_image i ON i.id = v.image_id ORDER BY v.name`,
  );
  assert.deepEqual(rows, [
    { name: 'db', image: 'Ubuntu 24.04' },
    { name: 'web', image: 'Ubuntu 24.04' },
    { name: 'worker', image: null },
  ]);
  const img = await db.get('SELECT source_type, source_id FROM virtualization_image');
  assert.deepEqual({ ...img }, { source_type: CLOUD_TYPE, source_id: ovh.id });
});

test('addresses become interfaces and IPs; the floating IP is primary', async () => {
  const vm = await db.get(
    `SELECT v.id, a.address AS primary_ip FROM virtualization_virtual_machine v
       JOIN ipam_ipaddress a ON a.id = v.primary_ip4_id WHERE v.name = 'web'`,
  );
  assert.equal(vm.primary_ip, '51.1.1.1/32');
  const ifaces = await names(
    'SELECT name FROM virtualization_vminterface WHERE virtual_machine_id = ?',
    [vm.id],
  );
  assert.deepEqual(ifaces, ['Ext-Net']);
  assert.equal(
    (
      await db.get(
        `SELECT COUNT(*) n FROM ipam_ipaddress WHERE assigned_object_type = 'virtualization.vminterface'`,
      )
    ).n,
    2,
  );
});

test('an attached volume becomes a disk of its VM; an unattached one is skipped', async () => {
  const disks = await all(
    `SELECT d.name, d.size, v.name AS vm FROM virtualization_virtual_disk d
       JOIN virtualization_virtual_machine v ON v.id = d.virtual_machine_id`,
  );
  assert.deepEqual(disks, [{ name: 'data', size: 100, vm: 'web' }]);
});

test('keypairs become SSH keys owned by the cloud; x509 keypairs are ignored', async () => {
  const keys = await all(
    'SELECT name, public_key, source_type, source_id FROM virtualization_ssh_key',
  );
  assert.equal(keys.length, 1); // the same key in two regions is one row
  assert.deepEqual(
    { ...keys[0] },
    {
      name: 'laptop',
      public_key: ED25519,
      source_type: CLOUD_TYPE,
      source_id: ovh.id,
    },
  );
});

test('the password never reaches the journal or the cloud error', async () => {
  const journal = JSON.stringify(await all('SELECT comments FROM extras_journalentry'));
  const cloud = JSON.stringify(await all('SELECT error FROM plugin_openstack_cloud'));
  assert.ok(!journal.includes(os.state.password));
  assert.ok(!cloud.includes(os.state.password));
  assert.ok((await journalCount(ovh.id)) >= 2);
});

test('region-status reports each region, its cluster and its VM count', async () => {
  const res = await api('GET', `${CLOUDS}${ovh.id}/region-status/`);
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.results.map((r) => [r.name, r.cluster, r.servers, r.error]),
    [
      ['GRA9', 'ovh (GRA9)', 2, null],
      ['SBG5', 'ovh (SBG5)', 1, null],
    ],
  );
  assert.equal((await api('GET', `${CLOUDS}999/region-status/`)).status, 404);
});

// ---- later syncs update in place -------------------------------------------------------

test('a second sync changes nothing when nothing changed', async () => {
  const count = async () => [
    (await db.get('SELECT COUNT(*) n FROM virtualization_virtual_machine')).n,
    (await db.get('SELECT COUNT(*) n FROM ipam_ipaddress')).n,
    (await db.get('SELECT COUNT(*) n FROM virtualization_virtual_machine_type')).n,
    (await db.get('SELECT COUNT(*) n FROM virtualization_ssh_key')).n,
  ];
  const before = await count();
  assert.equal(await resync(ovh.id), 'connected');
  assert.deepEqual(await count(), before);
});

test('a renamed server keeps its VM; a removed server removes it; new servers appear', async () => {
  const id = (await db.get(`SELECT id FROM virtualization_virtual_machine WHERE name = 'web'`)).id;
  const gra = os.state.regions.GRA9;
  gra.servers[0].name = 'web-renamed';
  gra.servers.splice(1, 1); // worker is gone
  gra.servers.push(server('s-e', 'cache'));
  await resync(ovh.id);

  assert.equal(
    (await db.get('SELECT name FROM virtualization_virtual_machine WHERE id = ?', [id])).name,
    'web-renamed',
  );
  assert.deepEqual(await names('SELECT name FROM virtualization_virtual_machine'), [
    'cache',
    'db',
    'web-renamed',
  ]);
  // the type only the removed VM used goes with it; the shared one stays
  assert.deepEqual(await names('SELECT name FROM virtualization_virtual_machine_type'), ['b2-7']);
});

test('two servers with the same name in one region get distinct VM names', async () => {
  os.state.regions.GRA9.servers.push(server('s-f0123456789', 'cache'));
  await resync(ovh.id);
  const dup = await names(
    `SELECT name FROM virtualization_virtual_machine WHERE name LIKE 'cache%'`,
  );
  assert.equal(dup.length, 2);
  assert.ok(dup.includes('cache'));
  os.state.regions.GRA9.servers.pop();
  await resync(ovh.id);
  assert.deepEqual(
    await names(`SELECT name FROM virtualization_virtual_machine WHERE name LIKE 'cache%'`),
    ['cache'],
  );
});

test('an existing VM type of the same name is reused and left untouched', async () => {
  await db.execute(
    `INSERT INTO virtualization_virtual_machine_type (name, slug, default_vcpus) VALUES ('C2-15', 'c2-15-manual', 99)`,
  );
  os.state.regions.GRA9.servers.push(
    server('s-g', 'big', { flavor: { original_name: 'c2-15', vcpus: 4, ram: 15360, disk: 100 } }),
  );
  await resync(ovh.id);
  const types = await all(
    `SELECT name, default_vcpus FROM virtualization_virtual_machine_type WHERE lower(name) = 'c2-15'`,
  );
  assert.deepEqual(
    types.map((t) => [t.name, Number(t.default_vcpus)]),
    [['C2-15', 99]],
  );
  const big = await db.get(
    `SELECT t.name FROM virtualization_virtual_machine v
       JOIN virtualization_virtual_machine_type t ON t.id = v.virtual_machine_type_id WHERE v.name = 'big'`,
  );
  assert.equal(big.name, 'C2-15');
});

// ---- SSH keys: ownership and sharing ---------------------------------------------------

test('a key added by hand is never duplicated, changed or removed by the import', async () => {
  await db.execute(
    `INSERT INTO virtualization_ssh_key (name, public_key, description) VALUES ('mine', ?, 'by hand')`,
    [RSA],
  );
  os.state.regions.SBG5.keypairs.push({ name: 'ci', public_key: RSA });
  await resync(ovh.id);
  const keys = await all('SELECT name, source_id FROM virtualization_ssh_key ORDER BY name');
  assert.deepEqual(
    keys.map((k) => [k.name, k.source_id]),
    [
      ['laptop', ovh.id],
      ['mine', null],
    ],
  );

  os.state.regions.SBG5.keypairs.pop();
  await resync(ovh.id);
  assert.equal(
    (await db.get(`SELECT COUNT(*) n FROM virtualization_ssh_key WHERE name = 'mine'`)).n,
    1,
  );
});

test('a keypair removed in OpenStack removes its key', async () => {
  os.state.regions.GRA9.keypairs.push({ name: 'temp', public_key: RSA.replace('DhA', 'DhB') });
  await resync(ovh.id);
  assert.equal(
    (await db.get(`SELECT COUNT(*) n FROM virtualization_ssh_key WHERE name = 'temp'`)).n,
    1,
  );
  os.state.regions.GRA9.keypairs.pop();
  await resync(ovh.id);
  assert.equal(
    (await db.get(`SELECT COUNT(*) n FROM virtualization_ssh_key WHERE name = 'temp'`)).n,
    0,
  );
});

// ---- two clouds -------------------------------------------------------------------------

let second;

test('a second cloud shares the image and types, and gets its own copy of a key', async () => {
  second = await createCloud('ovh2');
  assert.deepEqual(await names('SELECT name FROM virtualization_image'), ['Ubuntu 24.04']);
  assert.equal(
    (
      await db.get(
        `SELECT COUNT(*) n FROM virtualization_virtual_machine_type WHERE lower(name) = 'b2-7'`,
      )
    ).n,
    1,
  );
  const keys = await all(
    `SELECT name, source_id FROM virtualization_ssh_key WHERE source_id IS NOT NULL ORDER BY source_id`,
  );
  assert.equal(keys.length, 2); // the same public key, one row per cloud
  assert.notEqual(keys[0].name, keys[1].name); // the second got a suffix: names are unique
  assert.equal((await db.get(`SELECT COUNT(*) n FROM dcim_region WHERE name = 'GRA9'`)).n, 1); // regions are shared
  assert.deepEqual(await names('SELECT name FROM dcim_site'), [
    'ovh (GRA9)',
    'ovh (SBG5)',
    'ovh2 (GRA9)',
    'ovh2 (SBG5)',
  ]);
});

test('deleting a cloud removes what it imported and nothing else', async () => {
  const before = (await db.get('SELECT COUNT(*) n FROM virtualization_virtual_machine')).n;
  const res = await api('DELETE', `${CLOUDS}${ovh.id}/`);
  assert.equal(res.status, 204);

  // only the second cloud's VMs remain, with their clusters, sites and image
  const left = await all(
    `SELECT c.name AS cluster FROM virtualization_virtual_machine v JOIN virtualization_cluster c ON c.id = v.cluster_id`,
  );
  assert.ok(left.length > 0 && left.length < before);
  assert.ok(left.every((r) => r.cluster.startsWith('ovh2')));
  assert.deepEqual(await names('SELECT name FROM dcim_site'), ['ovh2 (GRA9)', 'ovh2 (SBG5)']);
  assert.deepEqual(await names('SELECT name FROM virtualization_image'), ['Ubuntu 24.04']); // still used
  assert.deepEqual(
    await names('SELECT name FROM virtualization_ssh_key WHERE source_id IS NOT NULL'),
    await names('SELECT name FROM virtualization_ssh_key WHERE source_id = ?', [second.id]),
  );
  assert.equal(
    (await db.get(`SELECT COUNT(*) n FROM virtualization_ssh_key WHERE name = 'mine'`)).n,
    1,
  );
  assert.equal(
    (
      await db.get(
        `SELECT COUNT(*) n FROM extras_journalentry WHERE assigned_object_type = ? AND assigned_object_id = ?`,
        [CLOUD_TYPE, ovh.id],
      )
    ).n,
    0,
  );
});

test('deleting the last cloud leaves only what was added by hand', async () => {
  assert.equal((await api('DELETE', `${CLOUDS}${second.id}/`)).status, 204);
  assert.equal((await db.get('SELECT COUNT(*) n FROM virtualization_virtual_machine')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) n FROM virtualization_image')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) n FROM dcim_site')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) n FROM dcim_region')).n, 0);
  assert.equal((await db.get('SELECT COUNT(*) n FROM virtualization_cluster')).n, 0);
  assert.deepEqual(await names('SELECT name FROM virtualization_ssh_key'), ['mine']);
  assert.deepEqual(await names('SELECT name FROM virtualization_virtual_machine_type'), ['C2-15']); // added by hand
});
