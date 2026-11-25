// Reversible encryption for secrets paashup must hold itself (e.g. the service-account SSH
// private key — see serviceAccount.ts): AES-256-GCM with a key derived from PB_ENCRYPTION_KEY.
// There's no Vault/KMS in this project; this is the one place a secret is stored
// reversibly rather than hashed (like auth tokens) or left to an external agent.
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM nonce

function key(): Buffer {
  const secret = process.env.PB_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'PB_ENCRYPTION_KEY is not set — required to store/read encrypted secrets (e.g. the SSH service-account key)',
    );
  }
  // Accept any length/shape of input; always derive a fixed 32-byte key from it.
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/** Encrypt `plaintext` to a self-contained string (`iv.tag.ciphertext`, each base64). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString('base64')).join('.');
}

/** Reverse of {@link encryptSecret}. Throws if `stored` is malformed or the key doesn't match. */
export function decryptSecret(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted secret');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
