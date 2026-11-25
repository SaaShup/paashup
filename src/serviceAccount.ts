// paashup's own SSH identity: a single RSA keypair, generated once (idempotent, like
// ensureSeedToken), used to open the in-browser VM terminal (see
// plugins/docker/routes/ssh-terminal.ts). The public half is a normal row of the SSH key
// catalog (virtualization_ssh_key) — visible and deployable to VMs exactly like any key
// added by hand, through the existing agent push (plugins/docker/sshkeys.ts). The private
// half never leaves the DB in cleartext: it's stored AES-256-GCM-encrypted (secrets.ts)
// and only decrypted in memory, right before opening an SSH connection.
import crypto from 'node:crypto';
import type { Db } from './db/types.js';
import { encryptSecret, decryptSecret } from './secrets.js';

export const SERVICE_ACCOUNT_KEY_NAME = 'paashup-service-account';

/** Strip leading zero bytes, then re-add exactly one if the sign bit would otherwise be set. */
function toMpint(buf: Buffer): Buffer {
  let b = buf;
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  b = b.subarray(i);
  if (b.length && (b[0]! & 0x80) !== 0) b = Buffer.concat([Buffer.from([0]), b]);
  return b;
}

function sshField(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

/** Generate an RSA-4096 keypair and render the public half as an OpenSSH `authorized_keys` line. */
function generateKeyPair(comment: string): { publicKey: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicExponent: 65537,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const jwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' }) as {
    n: string;
    e: string;
  };
  const blob = Buffer.concat([
    sshField(Buffer.from('ssh-rsa')),
    sshField(toMpint(Buffer.from(jwk.e, 'base64url'))),
    sshField(toMpint(Buffer.from(jwk.n, 'base64url'))),
  ]);
  return {
    publicKey: `ssh-rsa ${blob.toString('base64')} ${comment}`,
    privateKeyPem: privateKey,
  };
}

/**
 * Idempotent: create paashup's SSH service-account key if it doesn't exist yet (its name is
 * unique in the catalog). Called at startup, same pattern/placement as `ensureSeedToken`.
 */
export async function ensureServiceAccountKey(db: Db): Promise<{ created: boolean; id: number }> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM virtualization_ssh_key WHERE name = ?',
    [SERVICE_ACCOUNT_KEY_NAME],
  );
  if (existing) return { created: false, id: Number(existing.id) };

  const { publicKey, privateKeyPem } = generateKeyPair(SERVICE_ACCOUNT_KEY_NAME);
  const res = await db.execute(
    `INSERT INTO virtualization_ssh_key (name, public_key, description, private_key_encrypted)
     VALUES (?, ?, ?, ?)`,
    [
      SERVICE_ACCOUNT_KEY_NAME,
      publicKey,
      "paashup's own key, used to open the VM terminal — deploy it to a VM to allow that.",
      encryptSecret(privateKeyPem),
    ],
  );
  return { created: true, id: Number(res.insertId) };
}

/** Whether the service-account public key is deployed (in `authorized_keys`, via the agent
 *  push) on this VM — `plugin_docker_vm_ssh_key` is paashup's last-read copy of that file. */
export async function isServiceAccountDeployedOn(db: Db, vmId: number): Promise<boolean> {
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM plugin_docker_vm_ssh_key d
       JOIN virtualization_ssh_key k ON k.id = d.ssh_key_id
      WHERE d.virtual_machine_id = ? AND k.name = ?`,
    [vmId, SERVICE_ACCOUNT_KEY_NAME],
  );
  return Number(row?.n ?? 0) > 0;
}

/** The decrypted PEM private key, or null if the service account key doesn't exist yet. */
export async function getServiceAccountPrivateKey(db: Db): Promise<string | null> {
  const row = await db.get<{ private_key_encrypted: string | null }>(
    'SELECT private_key_encrypted FROM virtualization_ssh_key WHERE name = ?',
    [SERVICE_ACCOUNT_KEY_NAME],
  );
  if (!row?.private_key_encrypted) return null;
  return decryptSecret(row.private_key_encrypted);
}
