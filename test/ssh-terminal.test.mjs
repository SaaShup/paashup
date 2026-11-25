// The VM SSH terminal WebSocket relay (src/plugins/docker/routes/ssh-terminal.ts):
//   browser --(ws /api/plugins/docker/virtual-machines/:id/ssh/)--> paashup --(ssh2)--> sshd
// paashup is the SSH *client* here (unlike the Docker exec terminal, which proxies to an
// agent), using its own service-account key. A real `ssh2.Server` stands in for the VM's
// sshd, so this exercises the actual SSH handshake/pty/exec plumbing, not just a stub.
// Run: node --test test/ssh-terminal.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ssh2 from 'ssh2';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { createApiServer } from '../dist/api/server.js';
import dockerPlugin from '../dist/plugins/docker/index.js';
import { ensureServiceAccountKey } from '../dist/serviceAccount.js';

const { Server: SshServer } = ssh2;
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.ssh-terminal.sqlite');
const VMS = '/api/virtualization/virtual-machines/';

const MSG = { stdin: 0, stdout: 1, resize: 50, resume: 100, stopped: 200 };

// ---- a real (local) sshd, accepting exactly one known public key --------------------------

function hostKeyPem() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

/**
 * `acceptedBlob`: the exact OpenSSH wire-format public key blob (Buffer) to authenticate —
 * paashup's service-account key, parsed from its `ssh-rsa <base64> …` line. Anything else is
 * rejected. Records what it was asked to run (`seen`).
 */
function startSshd(acceptedBlob, bindAddress = '127.0.0.1') {
  const seen = { username: null, command: null, resized: null, shellData: [] };
  const server = new SshServer({ hostKeys: [hostKeyPem()] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method !== 'publickey') return ctx.reject(['publickey']);
      if (!acceptedBlob || !ctx.key.data.equals(acceptedBlob)) return ctx.reject(['publickey']);
      seen.username = ctx.username;
      ctx.accept(); // test-only sshd: skips signature verification (see file header)
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept && accept());
        session.on('window-change', (accept, reject, info) => {
          seen.resized = { rows: info.rows, cols: info.cols };
          if (accept) accept();
        });
        session.on('exec', (accept, reject, info) => {
          seen.command = info.command;
          const stream = accept();
          stream.write(`ran: ${info.command}\r\n`);
          stream.exit(0);
          stream.end();
        });
        session.on('shell', (accept) => {
          const stream = accept();
          stream.write('welcome$ ');
          stream.on('data', (d) => {
            seen.shellData.push(d.toString());
            if (d.toString() === 'exit\r') {
              stream.exit(0);
              stream.end();
            } else {
              stream.write(d); // echo
            }
          });
        });
      });
    });
  });
  return {
    seen,
    listen: () => new Promise((r) => server.listen(0, bindAddress, r)),
    port: () => server.address().port,
    close: () => new Promise((r) => server.close(r)),
  };
}

/** The OpenSSH wire-format blob of an `ssh-rsa <base64> …` public key line. */
function blobOf(publicKey) {
  return Buffer.from(publicKey.trim().split(/\s+/)[1], 'base64');
}

// ---- paashup + a VM pointed at the fake sshd -----------------------------------------------

let db, server, base, sshKeyId, servicePublicKey;

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

/** A VM with primary IP `ip`; returns its id. */
async function vm(name, ip) {
  const v = (await api('POST', VMS, { name, status: 'active' })).body;
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

/** Mark the service-account key as deployed on `vmId`, with `account` as its reported login. */
async function markDeployed(vmId, account) {
  await db.execute(
    `INSERT INTO plugin_docker_vm_ssh_key
       (virtual_machine_id, ssh_key_id, fingerprint, name, account, key_type, public_key)
     VALUES (?, ?, ?, 'k', ?, 'ssh-rsa', ?)`,
    [vmId, sshKeyId, `fp-${vmId}`, account ?? null, servicePublicKey],
  );
}

/** Drive one WS session against paashup's SSH relay; resolves once closed. */
function session(vmId, query = '') {
  return new Promise((resolve) => {
    const wsBase = base.replace('http', 'ws');
    const ws = new WebSocket(`${wsBase}/api/plugins/docker/virtual-machines/${vmId}/ssh/${query}`);
    ws.binaryType = 'nodebuffer';
    const out = [];
    let exit = null;
    ws.on('message', (data) => {
      const b = Buffer.from(data);
      if (b[0] === MSG.stdout) out.push(b.subarray(1).toString());
      if (b[0] === MSG.resume) {
        ws.send(Buffer.from([MSG.resize, 24, 0, 80, 0])); // 24 rows, 80 cols, little-endian
        ws.send(Buffer.concat([Buffer.from([MSG.stdin]), Buffer.from('echo\r')]));
        setTimeout(
          () => ws.send(Buffer.concat([Buffer.from([MSG.stdin]), Buffer.from('exit\r')])),
          30,
        );
      }
      if (b[0] === MSG.stopped) {
        exit = b[1];
        ws.close(1000, 'bye');
      }
    });
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString(), out, exit }));
    ws.on('error', (err) => resolve({ error: err.message }));
    setTimeout(() => {
      if (ws.readyState <= WebSocket.OPEN) ws.terminate();
    }, 4000);
  });
}

before(async () => {
  process.env.PB_ENCRYPTION_KEY = 'ssh terminal test key';
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0019_service_ssh_key.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin]);

  const key = await ensureServiceAccountKey(db);
  sshKeyId = key.id;
  servicePublicKey = (
    await db.get('SELECT public_key FROM virtualization_ssh_key WHERE id = ?', [sshKeyId])
  ).public_key;

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  delete process.env.PB_ENCRYPTION_KEY;
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('no primary IP: closes 4004 without ever dialing anything', async () => {
  const noIp = (await api('POST', VMS, { name: 'vm-no-ip', status: 'active' })).body.id;
  const r = await session(noIp);
  assert.equal(r.code, 4004);
  assert.match(r.reason, /no primary ip/i);
});

test('an interactive shell: resize forwarded, input echoed, clean exit', async () => {
  const sshd = startSshd(blobOf(servicePublicKey), '127.0.0.1');
  await sshd.listen();
  const vmId = await vm('vm-shell', '127.0.0.1');
  // point the client's SSH port at our fake sshd (not real port 22)
  process.env.PB_SSH_PORT = String(sshd.port());
  await markDeployed(vmId, 'anastasiia');
  try {
    const r = await session(vmId); // no `command` query → ssh.shell()
    assert.equal(r.exit, 0, JSON.stringify(r));
    assert.ok(r.out.join('').includes('welcome$ '), 'missing shell greeting');
    assert.ok(r.out.join('').includes('echo\r'), 'input was not echoed back');
    assert.deepEqual(sshd.seen.resized, { rows: 24, cols: 80 });
    assert.equal(sshd.seen.username, 'anastasiia', 'should log in as the agent-reported account');
  } finally {
    delete process.env.PB_SSH_PORT;
    await sshd.close();
  }
});

test('a one-off command: runs via exec, not an interactive shell', async () => {
  const sshd = startSshd(blobOf(servicePublicKey), '127.0.0.2');
  await sshd.listen();
  const vmId = await vm('vm-exec', '127.0.0.2');
  process.env.PB_SSH_PORT = String(sshd.port());
  await markDeployed(vmId, 'ubuntu');
  try {
    const r = await session(vmId, '?command=htop');
    assert.equal(r.exit, 0, JSON.stringify(r));
    assert.ok(r.out.join('').includes('ran: htop'));
    assert.equal(sshd.seen.command, 'htop');
    assert.equal(sshd.seen.shellData.length, 0, 'should not have opened an interactive shell');
  } finally {
    delete process.env.PB_SSH_PORT;
    await sshd.close();
  }
});

test('falls back to PB_SSH_USERNAME when no key deployment is known for the VM', async () => {
  const sshd = startSshd(blobOf(servicePublicKey), '127.0.0.3');
  await sshd.listen();
  const vmId = await vm('vm-fallback', '127.0.0.3');
  process.env.PB_SSH_PORT = String(sshd.port());
  process.env.PB_SSH_USERNAME = 'fallback-user';
  try {
    const r = await session(vmId, '?command=true');
    assert.equal(r.exit, 0, JSON.stringify(r));
    assert.equal(sshd.seen.username, 'fallback-user');
  } finally {
    delete process.env.PB_SSH_PORT;
    delete process.env.PB_SSH_USERNAME;
    await sshd.close();
  }
});

test('auth refused, key not deployed on this VM: a clear, actionable message', async () => {
  const sshd = startSshd(null, '127.0.0.4'); // rejects every key
  await sshd.listen();
  const vmId = await vm('vm-refused-undeployed', '127.0.0.4');
  process.env.PB_SSH_PORT = String(sshd.port());
  try {
    const r = await session(vmId);
    assert.equal(r.code, 4003);
    assert.match(r.reason, /isn't deployed on this VM yet/);
  } finally {
    delete process.env.PB_SSH_PORT;
    await sshd.close();
  }
});

test('auth refused, key IS deployed (wrong account/host drift): the raw error, not the deploy hint', async () => {
  const sshd = startSshd(null, '127.0.0.5'); // rejects every key regardless
  await sshd.listen();
  const vmId = await vm('vm-refused-deployed', '127.0.0.5');
  process.env.PB_SSH_PORT = String(sshd.port());
  await markDeployed(vmId, 'someone');
  try {
    const r = await session(vmId);
    assert.equal(r.code, 4003);
    assert.doesNotMatch(r.reason, /isn't deployed/);
  } finally {
    delete process.env.PB_SSH_PORT;
    await sshd.close();
  }
});

test('no service-account key at all: closes 4502', async () => {
  const F = join(ROOT, 'test', '.ssh-terminal-nokey.sqlite');
  rmSync(F, { force: true });
  const db2 = new SqliteDb(F);
  db2.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db2.exec(readFileSync(join(ROOT, 'migrations', '0019_service_ssh_key.sqlite.sql'), 'utf8'));
  await loadPlugins(db2, [dockerPlugin]);
  const server2 = createApiServer({ db: db2 });
  await new Promise((r) => server2.listen(0, '127.0.0.1', r));
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    const v = await fetch(`${base2}${VMS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'vm-nokey', status: 'active' }),
    }).then((r) => r.json());
    const iface = await fetch(`${base2}/api/virtualization/interfaces/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ virtual_machine: v.id, name: 'eth0' }),
    }).then((r) => r.json());
    const addr = await fetch(`${base2}/api/ipam/ip-addresses/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: '127.0.0.6/32',
        status: 'active',
        assigned_object_type: 'virtualization.vminterface',
        assigned_object_id: iface.id,
      }),
    }).then((r) => r.json());
    await fetch(`${base2}${VMS}${v.id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_ip4: addr.id }),
    });

    const wsBase = base2.replace('http', 'ws');
    const r = await new Promise((resolve) => {
      const ws = new WebSocket(`${wsBase}/api/plugins/docker/virtual-machines/${v.id}/ssh/`);
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', (err) => resolve({ error: err.message }));
    });
    assert.equal(r.code, 4502);
    assert.match(r.reason, /No SSH service-account key configured/);
  } finally {
    await new Promise((r) => server2.close(r));
    await db2.close();
    rmSync(F, { force: true });
  }
});
