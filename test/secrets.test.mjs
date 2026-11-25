// Reversible secret encryption (src/secrets.ts): AES-256-GCM keyed from PB_ENCRYPTION_KEY.
// Run: node --test test/secrets.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../dist/secrets.js';

before(() => {
  process.env.PB_ENCRYPTION_KEY = 'a test key, any shape or length works — it is hashed first';
});
after(() => {
  delete process.env.PB_ENCRYPTION_KEY;
});

test('round-trips a secret', () => {
  const plaintext = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n';
  const stored = encryptSecret(plaintext);
  assert.notEqual(stored, plaintext);
  assert.equal(decryptSecret(stored), plaintext);
});

test('two encryptions of the same plaintext differ (random IV) but both decrypt back', () => {
  const a = encryptSecret('same');
  const b = encryptSecret('same');
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), 'same');
  assert.equal(decryptSecret(b), 'same');
});

test('decrypting with the wrong key fails', () => {
  const stored = encryptSecret('secret');
  process.env.PB_ENCRYPTION_KEY = 'a different key';
  try {
    assert.throws(() => decryptSecret(stored));
  } finally {
    process.env.PB_ENCRYPTION_KEY = 'a test key, any shape or length works — it is hashed first';
  }
});

test('decrypting a malformed value fails', () => {
  assert.throws(() => decryptSecret('not-the-right-shape'));
  assert.throws(() => decryptSecret('a.b')); // only 2 parts
});

test('encryptSecret throws without PB_ENCRYPTION_KEY configured', () => {
  delete process.env.PB_ENCRYPTION_KEY;
  try {
    assert.throws(() => encryptSecret('x'), /PB_ENCRYPTION_KEY/);
  } finally {
    process.env.PB_ENCRYPTION_KEY = 'a test key, any shape or length works — it is hashed first';
  }
});
