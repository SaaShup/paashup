// Docker host ↔ VM link (OpenStack plugin hooks + end of sync). A host with no VM and no
// device whose endpoint address is an address of exactly one VM interface is linked to it.
// Verifies: the match on create / update / after a cloud sync, IPv6 and credentials in the
// URL, and that the link is never guessed (unknown or ambiguous address), never overwritten
// and never removed.
// Run: node --test test/docker-vm-link.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { createApiServer } from '../dist/api/server.js';
import dockerPlugin from '../dist/plugins/docker/index.js';
import openstackPlugin from '../dist/plugins/openstack/index.js';
import { addr, region, server, startFakeOpenStack } from './fake-openstack.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.dockervmlink.sqlite');
const HOSTS = '/api/plugins/docker/hosts/';

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

/** A VM with one interface carrying `ips`; returns the VM id. */
async function vmWith(name, ...ips) {
  const vm = (
    await api('POST', '/api/virtualization/virtual-machines/', { name, status: 'active' })
  ).body;
  const iface = (
    await api('POST', '/api/virtualization/interfaces/', { virtual_machine: vm.id, name: 'eth0' })
  ).body;
  for (const ip of ips) {
    const res = await api('POST', '/api/ipam/ip-addresses/', {
      address: ip,
      status: 'active',
      assigned_object_type: 'virtualization.vminterface',
      assigned_object_id: iface.id,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  return vm.id;
}

async function createHost(name, endpoint, extra = {}) {
  const res = await api('POST', HOSTS, { name, endpoint, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

/** The VM id a host is linked to, once the (asynchronous) hook had time to run. */
async function linkOf(hostId, expectLinked = true) {
  for (let i = 0; i < (expectLinked ? 100 : 10); i++) {
    const row = await db.get(
      'SELECT virtual_machine_id AS vm FROM plugin_docker_host WHERE id = ?',
      [hostId],
    );
    if (row.vm != null) return Number(row.vm);
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

before(async () => {
  os = await startFakeOpenStack();
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0008_journalentry.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin, openstackPlugin]);
  apiServer = createApiServer({ db });
  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${apiServer.address().port}`;
});
after(async () => {
  await new Promise((r) => apiServer.close(r));
  await os.close();
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('a new host is linked to the VM that has its address', async () => {
  const vm = await vmWith('alpha', '10.1.1.1/32');
  const host = await createHost('h-alpha', 'http://10.1.1.1:1880');
  assert.equal(await linkOf(host), vm);
  // and the VM's detail query finds it
  const found = await api('GET', `${HOSTS}?virtual_machine_id=${vm}`);
  assert.deepEqual(
    found.body.results.map((h) => h.name),
    ['h-alpha'],
  );
});

test('credentials in the endpoint URL and any netmask on the VM address still match', async () => {
  const vm = await vmWith('beta', '10.2.2.2/24');
  const host = await createHost('h-beta', 'http://admin:secret@10.2.2.2:1880');
  assert.equal(await linkOf(host), vm);
});

test('an IPv6 endpoint matches the VM address', async () => {
  const vm = await vmWith('gamma', '2001:db8::7/128');
  const host = await createHost('h-gamma', 'http://[2001:db8::7]:1880');
  assert.equal(await linkOf(host), vm);
});

test('an unknown address links nothing', async () => {
  const host = await createHost('h-lost', 'http://9.9.9.9:1880');
  assert.equal(await linkOf(host, false), null);
});

test('an address several VMs have is never guessed', async () => {
  await vmWith('twin-a', '10.3.3.3/32');
  await vmWith('twin-b', '10.3.3.3/32');
  const host = await createHost('h-twin', 'http://10.3.3.3:1880');
  assert.equal(await linkOf(host, false), null);
});

test('a link set by hand is never overwritten, by create or by a later update', async () => {
  const chosen = await vmWith('chosen');
  const other = await vmWith('other', '10.4.4.4/32');
  const host = await createHost('h-manual', 'http://10.4.4.4:1880', { virtual_machine: chosen });
  assert.equal(await linkOf(host), chosen);

  await api('PATCH', `${HOSTS}${host}/`, { endpoint: 'http://10.4.4.4:2375' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await linkOf(host), chosen);
  assert.notEqual(chosen, other);
});

test('updating an unlinked host to an address a VM has links it', async () => {
  const vm = await vmWith('delta', '10.5.5.5/32');
  const host = await createHost('h-delta', 'http://9.8.7.6:1880');
  assert.equal(await linkOf(host, false), null);
  assert.equal(
    (await api('PATCH', `${HOSTS}${host}/`, { endpoint: 'http://10.5.5.5:1880' })).status,
    200,
  );
  assert.equal(await linkOf(host), vm);
});

test('an existing link is kept when the VM address changes', async () => {
  const vm = await vmWith('eps', '10.6.6.6/32');
  const host = await createHost('h-eps', 'http://10.6.6.6:1880');
  assert.equal(await linkOf(host), vm);
  await db.execute(
    `UPDATE ipam_ipaddress SET address = '10.6.6.99/32' WHERE address = '10.6.6.6/32'`,
  );
  await api('PATCH', `${HOSTS}${host}/`, { name: 'h-eps-renamed' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await linkOf(host), vm);
});

async function importServers(servers) {
  os.state.regions = {
    GRA9: region({ images: [{ id: 'img-ubuntu', name: 'Ubuntu 24.04' }], servers }),
  };
}
const cloudRow = () => db.get(`SELECT id, state FROM plugin_openstack_cloud WHERE name = 'ovh'`);
async function waitConnected(timeout = 5000) {
  const t0 = Date.now();
  for (;;) {
    const c = await cloudRow();
    if (c && (c.state === 'connected' || c.state === 'error')) return c;
    assert.ok(Date.now() - t0 < timeout, 'sync did not finish');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const vmId = async (name) =>
  (await db.get('SELECT id FROM virtualization_virtual_machine WHERE name = ?', [name]))?.id;

test('a host registered before its VM exists is linked by the cloud sync that imports it', async () => {
  const host = await createHost('h-early', 'http://10.9.9.9:1880');
  assert.equal(await linkOf(host, false), null);

  await importServers([
    server('s-1', 'imported', { addresses: { 'Ext-Net': [addr('10.9.9.9')] } }),
  ]);
  const created = await api('POST', '/api/plugins/openstack/clouds/', {
    name: 'ovh',
    auth_url: os.authUrl,
    username: os.state.user,
    password: os.state.password,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await waitConnected()).state, 'connected');

  assert.equal(await linkOf(host), Number(await vmId('imported')));
});

test('when the VM disappears from OpenStack the link is cleared and the host stays', async () => {
  const host = (await db.get(`SELECT id FROM plugin_docker_host WHERE name = 'h-early'`)).id;
  assert.ok(await linkOf(host));

  await importServers([]); // the server was deleted in OpenStack
  const cloud = await cloudRow();
  const journal = (await db.get(`SELECT COUNT(*) n FROM extras_journalentry`)).n;
  await api('PATCH', `/api/plugins/openstack/clouds/${cloud.id}/`, { operation: 'refresh' });
  for (
    let i = 0;
    i < 200 && (await db.get(`SELECT COUNT(*) n FROM extras_journalentry`)).n === journal;
    i++
  ) {
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.equal(await vmId('imported'), undefined);
  const row = await db.get('SELECT virtual_machine_id AS vm FROM plugin_docker_host WHERE id = ?', [
    host,
  ]);
  assert.equal(row.vm, null);
  assert.equal((await api('GET', `${HOSTS}${host}/`)).status, 200);
});

// ---- deleting a VM deletes the Docker host on it ------------------------------------------

const hostId = async (name) =>
  (await db.get('SELECT id FROM plugin_docker_host WHERE name = ?', [name]))?.id;
const until = async (fn, what) => {
  for (let i = 0; i < 300; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const plainVm = async (name) =>
  (await api('POST', '/api/virtualization/virtual-machines/', { name, status: 'active' })).body.id;

test('deleting a VM deletes its Docker host with what it discovered, and only that host', async () => {
  const doomed = await plainVm('doomed');
  const keeper = await plainVm('keeper');
  const host = await createHost('h-doomed', 'http://10.20.0.1:1880', { virtual_machine: doomed });
  const other = await createHost('h-keeper', 'http://10.20.0.2:1880', { virtual_machine: keeper });
  const free = await createHost('h-free', 'http://10.20.0.99:1880');
  const volume = await api('POST', '/api/plugins/docker/volumes/', { host, name: 'data' });
  assert.equal(volume.status, 201, JSON.stringify(volume.body));

  assert.equal(
    (await api('DELETE', `/api/virtualization/virtual-machines/${doomed}/`)).status,
    204,
  );

  assert.equal((await api('GET', `${HOSTS}${host}/`)).status, 404, 'the host went with its VM');
  assert.equal(
    (await api('GET', `/api/plugins/docker/volumes/${volume.body.id}/`)).status,
    404,
    'what the host discovered went too',
  );
  assert.equal((await api('GET', `${HOSTS}${other}/`)).status, 200, 'the other VM keeps its host');
  assert.equal(await linkOf(other), keeper);
  assert.equal((await api('GET', `${HOSTS}${free}/`)).status, 200, 'a host with no VM is left');
});

test('deleting a VM paashup created on OpenStack deletes its Docker host too', async () => {
  const gra = region({
    images: [{ id: 'img-ubuntu', name: 'Ubuntu 24.04' }],
    keypairs: [
      {
        name: 'laptop',
        public_key:
          'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@host',
      },
    ],
    servers: [],
  });
  os.state.regions = { GRA9: gra };
  const cloud = await cloudRow();
  const created = await api('POST', `/api/plugins/openstack/clouds/${cloud.id}/servers/`, {
    region: 'GRA9',
    name: 'built',
    flavor_id: 'fl-1',
    image_id: 'img-ubuntu',
    network_ids: ['net-ext'],
    ssh_key: { source: 'cloud', name: 'laptop' },
  });
  assert.equal(created.status, 202, JSON.stringify(created.body));
  const vm = created.body.vm_id;
  const host = await createHost('h-built', 'http://10.30.0.1:1880', { virtual_machine: vm });
  const bystander = await createHost('h-bystander', 'http://10.30.0.2:1880');
  assert.equal(await linkOf(host), vm);

  const res = await api('DELETE', `/api/plugins/openstack/servers/${vm}/`);
  assert.equal(res.status, 202, JSON.stringify(res.body));
  await until(async () => !(await vmId('built')), 'the VM to be removed');
  assert.equal(await hostId('h-built'), undefined, 'its Docker host is deleted with it');
  assert.equal((await api('GET', `${HOSTS}${bystander}/`)).status, 200);
});
