// paashup's own SSH service-account key (src/serviceAccount.ts): generated once, idempotent,
// public half readable in the virtualization_ssh_key catalog, private half round-trips through
// encryption and actually matches the public half.
// Run: node --test test/service-account.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import dockerPlugin from '../dist/plugins/docker/index.js';
import {
  ensureServiceAccountKey,
  getServiceAccountPrivateKey,
  isServiceAccountDeployedOn,
  SERVICE_ACCOUNT_KEY_NAME,
} from '../dist/serviceAccount.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.service-account.sqlite');
let db;

/** Parse an OpenSSH `ssh-rsa <base64> [comment]` line into its (e, n) wire fields. */
function parseSshRsa(publicKey) {
  const [algo, b64] = publicKey.trim().split(/\s+/);
  assert.equal(algo, 'ssh-rsa');
  const buf = Buffer.from(b64, 'base64');
  let off = 0;
  const readField = () => {
    const len = buf.readUInt32BE(off);
    off += 4;
    const f = buf.subarray(off, off + len);
    off += len;
    return f;
  };
  assert.equal(readField().toString(), 'ssh-rsa');
  const e = readField();
  const n = readField();
  return { e, n };
}

before(async () => {
  process.env.PB_ENCRYPTION_KEY = 'service-account test key';
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0019_service_ssh_key.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin]); // creates plugin_docker_vm_ssh_key
});
after(async () => {
  delete process.env.PB_ENCRYPTION_KEY;
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('creates the key once, is idempotent after that', async () => {
  const first = await ensureServiceAccountKey(db);
  assert.equal(first.created, true);
  const second = await ensureServiceAccountKey(db);
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);

  const rows = await db.query('SELECT id FROM virtualization_ssh_key WHERE name = ?', [
    SERVICE_ACCOUNT_KEY_NAME,
  ]);
  assert.equal(rows.length, 1);
});

test('the public key in the catalog matches the stored, decrypted private key', async () => {
  const row = await db.get(
    'SELECT public_key, private_key_encrypted FROM virtualization_ssh_key WHERE name = ?',
    [SERVICE_ACCOUNT_KEY_NAME],
  );
  assert.ok(row.public_key.startsWith('ssh-rsa '));
  assert.ok(row.public_key.trim().endsWith(SERVICE_ACCOUNT_KEY_NAME));
  assert.ok(row.private_key_encrypted, 'private key should be stored encrypted');
  assert.notEqual(row.private_key_encrypted, null);

  const privateKeyPem = await getServiceAccountPrivateKey(db);
  assert.match(privateKeyPem, /BEGIN RSA PRIVATE KEY/);

  // Derive (e, n) from the private key itself and compare against the public catalog entry.
  const jwk = crypto.createPrivateKey(privateKeyPem).export({ format: 'jwk' });
  const { e, n } = parseSshRsa(row.public_key);
  const stripLeadingZero = (b) => (b.length > 1 && b[0] === 0 ? b.subarray(1) : b);
  assert.equal(stripLeadingZero(e).toString('base64url'), jwk.e.replace(/=+$/, ''));
  assert.equal(stripLeadingZero(n).toString('base64url'), jwk.n.replace(/=+$/, ''));
});

test('isServiceAccountDeployedOn is false until a deployment row links the key to the VM', async () => {
  const keyRow = await db.get('SELECT id FROM virtualization_ssh_key WHERE name = ?', [
    SERVICE_ACCOUNT_KEY_NAME,
  ]);
  const { insertId: vmId } = await db.execute(
    "INSERT INTO virtualization_virtual_machine (name, status) VALUES ('vm-sa', 'active')",
  );
  assert.equal(await isServiceAccountDeployedOn(db, vmId), false);

  await db.execute(
    `INSERT INTO plugin_docker_vm_ssh_key (virtual_machine_id, ssh_key_id, fingerprint, name, key_type, public_key)
     VALUES (?, ?, 'fp', 'n', 'ssh-rsa', 'ssh-rsa AAAA')`,
    [vmId, keyRow.id],
  );
  assert.equal(await isServiceAccountDeployedOn(db, vmId), true);
});

test('getServiceAccountPrivateKey is null when no key exists yet', async () => {
  const F = join(ROOT, 'test', '.service-account-empty.sqlite');
  rmSync(F, { force: true });
  const empty = new SqliteDb(F);
  empty.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  empty.exec(readFileSync(join(ROOT, 'migrations', '0019_service_ssh_key.sqlite.sql'), 'utf8'));
  try {
    assert.equal(await getServiceAccountPrivateKey(empty), null);
  } finally {
    await empty.close();
    rmSync(F, { force: true });
  }
});
