// VM SSH keys: the authorized_keys of each VM, read and changed through the agent at its
// primary IP (PB_SSH_AGENT_USER / PB_SSH_AGENT_PASSWORD / PB_SSH_AGENT_PORT). A fake agent
// speaks the agent's /api/ssh-keys (Basic auth, revisions, 409 on a stale one, disabled).
// Verifies:
//   - nothing happens without the agent credentials
//   - a sync of the VMs' cloud (when added or refreshed) stores each VM's keys, and only for
//     that cloud's VMs; a key missing from the catalog is imported there
//     (origin "agent", the VM as source), and goes once no VM has it
//   - a catalog key or a pasted one is deployed; bad input, duplicates, a VM without IP and
//     a disabled agent are refused; a stale revision is retried once
//   - a key is removed from its VM (also when already gone from the file); never edited
//   - a key added by hand takes over the agent's copy; a deleted one comes back at the sync
//   - the catalog shows each key's origin and how many VMs have it
// Run: node --test test/vm-ssh-keys.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins, fireHooks } from '../dist/plugins/runtime.js';
import { createApiServer } from '../dist/api/server.js';
import dockerPlugin from '../dist/plugins/docker/index.js';
import openstackPlugin from '../dist/plugins/openstack/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.vmsshkeys.sqlite');
const DEPLOY = '/api/plugins/docker/vm-ssh-keys/';
const KEYS = '/api/virtualization/ssh-keys/';
const VMS = '/api/virtualization/virtual-machines/';
const DISABLED = 'Host SSH key management is disabled';

let db, apiServer, base, agent;

// ---- fake agent ---------------------------------------------------------------------------

/** An OpenSSH Ed25519 public key `ssh-ed25519 <base64> <comment>`. */
function makeKey(comment) {
  const raw = crypto
    .generateKeyPairSync('ed25519')
    .publicKey.export({ format: 'der', type: 'spki' })
    .subarray(-32);
  const str = (b) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
  const blob = Buffer.concat([str(Buffer.from('ssh-ed25519')), str(raw)]);
  return `ssh-ed25519 ${blob.toString('base64')} ${comment}`;
}
const fingerprintOf = (publicKey) =>
  `SHA256:${crypto
    .createHash('sha256')
    .update(Buffer.from(publicKey.split(' ')[1], 'base64'))
    .digest('base64')
    .replace(/=+$/, '')}`;

/**
 * One authorized_keys per loopback address (one per VM): `keys` holds its public keys,
 * `disabled` makes it answer as an agent without SSH key management, `notAgent` as
 * something else, `staleOnce` changes the file just before the next write (so it is stale).
 */
const files = new Map();
const fileOf = (ip) => {
  if (!files.has(ip))
    files.set(ip, { keys: [], disabled: false, notAgent: false, staleOnce: false });
  return files.get(ip);
};
const revisionOf = (f) => crypto.createHash('sha256').update(JSON.stringify(f.keys)).digest('hex');
const listOf = (f) => ({
  account: 'debian',
  revision: revisionOf(f),
  keys: f.keys.map((k) => ({
    id: crypto.createHash('sha256').update(k).digest('hex'),
    type: 'ssh-ed25519',
    fingerprint: fingerprintOf(k),
    comment: k.split(' ').slice(2).join(' '),
    publicKey: k,
    options: '',
  })),
});

function startAgent() {
  agent = http.createServer((req, res) => {
    const f = fileOf(req.socket.localAddress.replace(/^::ffff:/, ''));
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (f.notAgent) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>hello</html>');
    }
    const auth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
    if (req.headers.authorization !== auth) return send(401, { message: 'Unauthorized' });
    if (req.url !== '/api/ssh-keys') return send(404, { message: 'Not found' });
    if (f.disabled) return send(404, { message: DISABLED });
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'GET') return send(200, listOf(f));
      const body = JSON.parse(raw || '{}');
      if (f.staleOnce) {
        f.staleOnce = false;
        f.keys.push(makeKey('concurrent')); // someone else changed the file meanwhile
      }
      if (body.revision !== revisionOf(f)) {
        return send(409, { message: 'SSH keys changed; reload before trying again' });
      }
      if (req.method === 'POST') {
        const k = String(body.publicKey ?? '');
        if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}( [^\n]*)?$/.test(k)) {
          return send(400, { message: 'Supply one OpenSSH public key' });
        }
        if (f.keys.some((x) => fingerprintOf(x) === fingerprintOf(k))) {
          return send(409, { message: 'This public key is already authorized' });
        }
        f.keys.push(k);
        return send(200, { backup: 'b', revision: revisionOf(f) });
      }
      if (req.method === 'DELETE') {
        const entry = listOf(f).keys.find((k) => k.id === body.id);
        if (!entry) return send(404, { message: 'SSH key no longer exists' });
        f.keys = f.keys.filter((k) => k !== entry.publicKey);
        return send(200, { backup: 'b', revision: revisionOf(f) });
      }
      return send(405, { message: 'Method not allowed' });
    });
  });
  return new Promise((r) => agent.listen(0, '0.0.0.0', r));
}

// ---- helpers --------------------------------------------------------------------------------

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

/** Wait for `fn` to return something truthy (reads after a sync run in the background). */
async function until(fn, what) {
  for (let i = 0; i < 150; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** A VM whose primary IP is `ip` (no IP when omitted); returns its id. */
async function vm(name, ip) {
  const v = (await api('POST', VMS, { name, status: 'active' })).body;
  if (!ip) return v.id;
  const iface = (
    await api('POST', '/api/virtualization/interfaces/', { virtual_machine: v.id, name: 'eth0' })
  ).body;
  const addr = (
    await api('POST', '/api/ipam/ip-addresses/', {
      address: `${ip}/32`,
      status: 'active',
      assigned_object_type: 'virtualization.vminterface',
      assigned_object_id: iface.id,
    })
  ).body;
  assert.equal((await api('PATCH', `${VMS}${v.id}/`, { primary_ip4: addr.id })).status, 200);
  return v.id;
}

const deploymentsOf = async (vmId) =>
  (await api('GET', `${DEPLOY}?virtual_machine_id=${vmId}&limit=100`)).body.results;
const catalogKey = async (id) => (await api('GET', `${KEYS}${id}/`)).body;
const catalogByComment = async (comment) =>
  (await api('GET', `${KEYS}?limit=500`)).body.results.find((k) =>
    k.public_key.endsWith(` ${comment}`),
  );
/** The end of a sync of the cloud the VMs are on (`cloud` by default). */
const sync = (cloud = cloudId) => fireHooks(db, 'plugin_openstack_cloud', 'synced', cloud);

/** An OpenStack cloud holding these VMs; returns its id. */
async function cloudWith(name, ...vmIds) {
  await db.execute(
    `INSERT INTO plugin_openstack_cloud (name, auth_url, username, password, project_name)
     VALUES (?, 'http://x', 'u', 'p', 'p')`,
    [name],
  );
  const { id } = await db.get('SELECT id FROM plugin_openstack_cloud WHERE name = ?', [name]);
  for (const vmId of vmIds) {
    await db.execute(
      `INSERT INTO plugin_openstack_server (cloud_id, server_id, virtual_machine_id)
       VALUES (?, ?, ?)`,
      [id, `s-${vmId}`, vmId],
    );
  }
  return id;
}

const configure = () => {
  process.env.PB_SSH_AGENT_USER = 'admin';
  process.env.PB_SSH_AGENT_PASSWORD = 'secret';
  process.env.PB_SSH_AGENT_PORT = String(agent.address().port);
};

let vmA, vmB, vmNoIp; // agents at 127.0.0.1 and 127.0.0.2, and a VM without IP
let cloudId; // the cloud the three VMs are on
const A = '127.0.0.1';
const B = '127.0.0.2';

before(async () => {
  await startAgent();
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0008_journalentry.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin, openstackPlugin]);
  apiServer = createApiServer({ db });
  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${apiServer.address().port}`;
  vmA = await vm('vm-a', A);
  vmB = await vm('vm-b', B);
  vmNoIp = await vm('vm-no-ip');
  cloudId = await cloudWith('cloud', vmA, vmB, vmNoIp);
});
after(async () => {
  for (const k of ['PB_SSH_AGENT_USER', 'PB_SSH_AGENT_PASSWORD', 'PB_SSH_AGENT_PORT']) {
    delete process.env[k];
  }
  await new Promise((r) => apiServer.close(r));
  await new Promise((r) => agent.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

// ---- tests ----------------------------------------------------------------------------------

test('without the agent credentials, nothing is read nor written', async () => {
  const key = (await api('POST', KEYS, { name: 'early', public_key: makeKey('early') })).body;
  const add = await api('POST', DEPLOY, { virtual_machine: vmA, ssh_key: key.id });
  assert.equal(add.status, 400);
  assert.match(add.body.detail, /PB_SSH_AGENT_USER/);
  fileOf(A).keys = [makeKey('unread')];
  await sync();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await deploymentsOf(vmA)).length, 0);
  await api('DELETE', `${KEYS}${key.id}/`);
});

test('a sync stores the keys of each VM and imports the unknown ones into the catalog', async () => {
  configure();
  fileOf(A).keys = [makeKey('alice@laptop')];
  fileOf(B).keys = [makeKey('bob')];
  await sync();
  const [onA] = await until(async () => {
    const d = await deploymentsOf(vmA);
    return d.length ? d : null;
  }, 'the keys of vm-a');
  await until(async () => (await deploymentsOf(vmB)).length === 1, 'the keys of vm-b');
  assert.equal(onA.account, 'debian');
  assert.equal(onA.fingerprint, fingerprintOf(fileOf(A).keys[0]));

  const imported = await catalogKey(onA.ssh_key.id);
  assert.equal(imported.origin, 'agent');
  assert.equal(imported.source.id, vmA);
  assert.equal(imported.deployed_on, 1);
  assert.equal(imported.name, 'alice-laptop'); // usable as a Nova keypair name
});

test('a catalog key is deployed to a VM and counted there', async () => {
  const publicKey = makeKey('ops');
  const key = (await api('POST', KEYS, { name: 'ops', public_key: publicKey })).body;
  assert.equal(key.origin, 'paashup');
  assert.equal(key.deployed_on, 0);

  const add = await api('POST', DEPLOY, { virtual_machine: vmA, ssh_key: key.id });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.body.virtual_machine.id, vmA);
  assert.equal(add.body.ssh_key.id, key.id);
  assert.ok(fileOf(A).keys.includes(publicKey));
  assert.equal((await catalogKey(key.id)).deployed_on, 1);

  // the same key again: the agent refuses it
  const again = await api('POST', DEPLOY, { virtual_machine: vmA, ssh_key: key.id });
  assert.equal(again.status, 409);
});

test('a pasted key is deployed, and listed in the catalog as found by the agent', async () => {
  const add = await api('POST', DEPLOY, { virtual_machine: vmB, public_key: makeKey('pasted') });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal((await catalogKey(add.body.ssh_key.id)).origin, 'agent');
});

test('bad requests are refused before or by the agent', async () => {
  const key = await catalogByComment('ops');
  const both = await api('POST', DEPLOY, {
    virtual_machine: vmA,
    ssh_key: key.id,
    public_key: makeKey('x'),
  });
  assert.equal(both.status, 400);
  assert.ok(both.body.ssh_key);
  assert.equal((await api('POST', DEPLOY, { virtual_machine: vmA })).status, 400);

  const noIp = await api('POST', DEPLOY, { virtual_machine: vmNoIp, ssh_key: key.id });
  assert.equal(noIp.status, 400);
  assert.match(noIp.body.virtual_machine[0], /primary IP/);

  const junk = await api('POST', DEPLOY, { virtual_machine: vmA, public_key: 'not a key' });
  assert.equal(junk.status, 400);
  assert.deepEqual(junk.body.public_key, ['Supply one OpenSSH public key']);
});

test('a write against a file changed meanwhile is retried once', async () => {
  const publicKey = makeKey('retry');
  fileOf(A).staleOnce = true;
  const add = await api('POST', DEPLOY, { virtual_machine: vmA, public_key: publicKey });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.ok(fileOf(A).keys.includes(publicKey));
});

test('a key is removed from its VM; the agent copy goes once no VM has it', async () => {
  const row = (await deploymentsOf(vmA)).find((d) => d.comment === 'retry');
  const catalogId = row.ssh_key.id;
  assert.equal((await api('DELETE', `${DEPLOY}${row.id}/`)).status, 204);
  assert.ok(!fileOf(A).keys.some((k) => k.endsWith(' retry')));
  assert.ok(!(await deploymentsOf(vmA)).some((d) => d.comment === 'retry'));
  assert.equal((await api('GET', `${KEYS}${catalogId}/`)).status, 404);

  // a paashup key removed from its only VM stays in the catalog
  const ops = await catalogByComment('ops');
  const opsRow = (await deploymentsOf(vmA)).find((d) => d.ssh_key.id === ops.id);
  assert.equal((await api('DELETE', `${DEPLOY}${opsRow.id}/`)).status, 204);
  assert.equal((await catalogKey(ops.id)).deployed_on, 0);
});

test('removing a key already gone from the file just drops it', async () => {
  const row = (await deploymentsOf(vmB)).find((d) => d.comment === 'pasted');
  fileOf(B).keys = fileOf(B).keys.filter((k) => !k.endsWith(' pasted')); // edited on the VM
  assert.equal((await api('DELETE', `${DEPLOY}${row.id}/`)).status, 204);
  assert.ok(!(await deploymentsOf(vmB)).some((d) => d.comment === 'pasted'));
});

test('a key is added or removed, never edited', async () => {
  const [row] = await deploymentsOf(vmA);
  assert.equal((await api('PATCH', `${DEPLOY}${row.id}/`, { account: 'root' })).status, 405);
  assert.equal((await api('PUT', `${DEPLOY}${row.id}/`, {})).status, 405);
});

test('a key added by hand takes over the copy imported from the agent', async () => {
  const agentCopy = await catalogByComment('alice@laptop');
  assert.equal(agentCopy.origin, 'agent');
  const mine = (await api('POST', KEYS, { name: 'alice', public_key: fileOf(A).keys[0] })).body;
  assert.equal((await api('GET', `${KEYS}${agentCopy.id}/`)).status, 404);
  const [row] = (await deploymentsOf(vmA)).filter((d) => d.comment === 'alice@laptop');
  assert.equal(row.ssh_key.id, mine.id);
  assert.equal((await catalogKey(mine.id)).deployed_on, 1);
});

test('a key deleted from the catalog while on a VM comes back at the next sync', async () => {
  const mine = await catalogByComment('alice@laptop');
  assert.equal((await api('DELETE', `${KEYS}${mine.id}/`)).status, 204);
  await sync();
  const back = await until(async () => {
    const k = await catalogByComment('alice@laptop');
    return k && k.id !== mine.id ? k : null;
  }, 'the key imported again');
  assert.equal(back.origin, 'agent');
});

test('a disabled agent leaves its VM without keys and refuses additions', async () => {
  fileOf(B).disabled = true;
  await sync();
  await until(async () => (await deploymentsOf(vmB)).length === 0, 'vm-b without keys');
  const add = await api('POST', DEPLOY, { virtual_machine: vmB, public_key: makeKey('nope') });
  assert.equal(add.status, 400);
  assert.match(add.body.virtual_machine[0], /isn't enabled/);
  // bob's imported key went with it
  assert.equal(await catalogByComment('bob'), undefined);
  fileOf(B).disabled = false;
});

test('something else than an agent answering is ignored', async () => {
  fileOf(B).keys = [makeKey('carol')];
  fileOf(B).notAgent = true;
  await sync();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await deploymentsOf(vmB)).length, 0);
  fileOf(B).notAgent = false;
});

test("a sync reads only the cloud's own VMs", async () => {
  // carol's key was added on vm-b meanwhile: another cloud's sync doesn't read it
  await sync(await cloudWith('other-cloud'));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!(await deploymentsOf(vmB)).some((d) => d.comment === 'carol'));
  await sync();
  await until(
    async () => (await deploymentsOf(vmB)).some((d) => d.comment === 'carol'),
    "carol's key on vm-b",
  );
});

test("a deleted VM's keys go, and the agent keys only it had", async () => {
  const carol = await catalogByComment('carol');
  assert.equal(carol.origin, 'agent');
  // the VM's address and interface first (they hold it)
  await api('PATCH', `${VMS}${vmB}/`, { primary_ip4: null });
  const ifaces = (await api('GET', `/api/virtualization/interfaces/?virtual_machine_id=${vmB}`))
    .body.results;
  for (const i of ifaces) {
    const ips = (
      await api(
        'GET',
        `/api/ipam/ip-addresses/?assigned_object_type=virtualization.vminterface&assigned_object_id=${i.id}`,
      )
    ).body.results;
    for (const ip of ips) await api('DELETE', `/api/ipam/ip-addresses/${ip.id}/`);
    await api('DELETE', `/api/virtualization/interfaces/${i.id}/`);
  }
  assert.equal((await api('DELETE', `${VMS}${vmB}/`)).status, 204);
  assert.equal((await deploymentsOf(vmB)).length, 0);
  assert.equal((await api('GET', `${KEYS}${carol.id}/`)).status, 404);
});
