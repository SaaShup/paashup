// Core Image and SSH key entities (Virtualization). Verifies:
//   - images: CRUD, unique name, the VM's `image` link (and what happens when the image goes)
//   - SSH keys: OpenSSH public keys accepted; private keys, junk, multi-line values and
//     duplicate names refused on create and on update
//   - the `source` fields (where a row was imported from) are hidden from the forms
// Run: node --test test/images-ssh-keys.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.imageskeys.sqlite');
const IMAGES = '/api/virtualization/images/';
const KEYS = '/api/virtualization/ssh-keys/';
const VMS = '/api/virtualization/virtual-machines/';

const ED25519 =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@host';
const RSA = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7vbqajDhA';
const ECDSA = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=';

let db, server, base;

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

// ---- images ----------------------------------------------------------------------------

test('an image can be created, read, renamed and deleted', async () => {
  const created = await api('POST', IMAGES, { name: 'Debian 12', description: 'base image' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal((await api('GET', `${IMAGES}${id}/`)).body.name, 'Debian 12');
  assert.equal(
    (await api('PATCH', `${IMAGES}${id}/`, { name: 'Debian 12.5' })).body.name,
    'Debian 12.5',
  );
  assert.equal((await api('DELETE', `${IMAGES}${id}/`)).status, 204);
  assert.equal((await api('GET', `${IMAGES}${id}/`)).status, 404);
});

test('an image needs a name, and the name is unique', async () => {
  assert.equal((await api('POST', IMAGES, {})).status, 400);
  assert.equal((await api('POST', IMAGES, { name: 'Alpine' })).status, 201);
  assert.equal((await api('POST', IMAGES, { name: 'Alpine' })).status, 400);
});

let imageId;

test('a VM points to its image; deleting the image only clears the link', async () => {
  imageId = (await api('POST', IMAGES, { name: 'Ubuntu 24.04' })).body.id;
  const vm = await api('POST', VMS, { name: 'web', status: 'active', image: imageId });
  assert.equal(vm.status, 201, JSON.stringify(vm.body));
  assert.equal(vm.body.image.id, imageId);
  assert.equal(vm.body.image.name, 'Ubuntu 24.04');

  const byImage = await api('GET', `${VMS}?image_id=${imageId}`);
  assert.equal(byImage.body.count, 1);

  assert.equal((await api('DELETE', `${IMAGES}${imageId}/`)).status, 204);
  const after = await api('GET', `${VMS}${vm.body.id}/`);
  assert.equal(after.status, 200);
  assert.equal(after.body.image, null);
});

test('a VM without an image reports none', async () => {
  const vm = await api('POST', VMS, { name: 'bare', status: 'active' });
  assert.equal(vm.body.image, null);
});

// ---- SSH keys --------------------------------------------------------------------------

test('OpenSSH public keys of the usual types are accepted', async () => {
  let n = 0;
  for (const key of [ED25519, RSA, ECDSA]) {
    const res = await api('POST', KEYS, { name: `key-${++n}`, public_key: key });
    assert.equal(res.status, 201, `${key.slice(0, 12)}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.public_key, key);
  }
});

test('surrounding whitespace is stripped from a pasted key', async () => {
  const res = await api('POST', KEYS, { name: 'padded', public_key: `  ${ED25519}\n` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const stored = await db.get('SELECT public_key FROM virtualization_ssh_key WHERE name = ?', [
    'padded',
  ]);
  assert.equal(stored.public_key, ED25519);
});

test('a private key is refused, with a message that says so', async () => {
  const res = await api('POST', KEYS, {
    name: 'oops',
    public_key:
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.public_key[0], /private key/i);
  assert.equal(
    (await db.get(`SELECT COUNT(*) n FROM virtualization_ssh_key WHERE name = 'oops'`)).n,
    0,
  );
});

test('junk, multi-line and unknown-type values are refused', async () => {
  for (const bad of [
    'hello world',
    `${ED25519}\n${ED25519}`,
    'ssh-unknown AAAAC3Nza',
    'ssh-ed25519',
  ]) {
    const res = await api('POST', KEYS, { name: 'bad', public_key: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.ok(res.body.public_key, JSON.stringify(res.body));
  }
});

test('the key and the name are both required; names are unique', async () => {
  assert.equal((await api('POST', KEYS, { name: 'no-key' })).status, 400);
  assert.equal((await api('POST', KEYS, { public_key: RSA })).status, 400);
  assert.equal((await api('POST', KEYS, { name: 'key-1', public_key: RSA })).status, 400);
});

test('updating a key to an invalid value is refused; a valid one is stored', async () => {
  const id = (await api('POST', KEYS, { name: 'editable', public_key: RSA })).body.id;
  assert.equal((await api('PATCH', `${KEYS}${id}/`, { public_key: 'nonsense' })).status, 400);
  assert.equal(
    (await api('PATCH', `${KEYS}${id}/`, { public_key: ED25519 })).body.public_key,
    ED25519,
  );
  assert.equal(
    (await api('PATCH', `${KEYS}${id}/`, { description: 'laptop key' })).body.description,
    'laptop key',
  );
});

test('a new key must have a name OpenStack accepts as a keypair name', async () => {
  let n = 0;
  for (const name of ['laptop', 'my_key-2', 'Alice Work Laptop', 'A1']) {
    const res = await api('POST', KEYS, {
      name,
      public_key: ED25519.replace('Jl', `J${String.fromCharCode(97 + n++)}`),
    });
    assert.equal(res.status, 201, `${name}: ${JSON.stringify(res.body)}`);
  }
  for (const name of ['ana@example.com', 'my.key', ' lead', 'trail ', 'a/b', 'clé']) {
    const res = await api('POST', KEYS, { name, public_key: ED25519 });
    assert.equal(res.status, 400, `"${name}" is refused`);
    assert.match(res.body.name[0], /letters, digits/);
  }
});

test('a key that already has such a name can still be edited (imported keys)', async () => {
  // an import can store a name the form would now refuse (e.g. "@" on a recent Nova)
  const id = (
    await db.execute(
      `INSERT INTO virtualization_ssh_key (name, public_key) VALUES ('imp@example.com', ?)`,
      [RSA.replace('DhA', 'DhZ')],
    )
  ).insertId;
  const res = await api('PATCH', `${KEYS}${id}/`, { description: 'from the cloud' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

// ---- where a row comes from -------------------------------------------------------------

test('a row created by hand has no source', async () => {
  const key = await api('GET', `${KEYS}?name=key-1`);
  assert.equal(key.body.results[0].source, null);
  const img = (await api('POST', IMAGES, { name: 'manual' })).body;
  assert.equal(img.source, null);
});

test('the source fields are hidden from the forms', async () => {
  const doc = (await api('GET', '/api/schema/')).body;
  const writes = Object.entries(doc.components.schemas).filter(([n]) =>
    /^(Writable)?(Image|SshKey)Request$/.test(n),
  );
  assert.ok(writes.length >= 2, 'the write schemas exist');
  for (const [name, schema] of writes) {
    for (const f of ['source_type', 'source_id']) {
      assert.equal(schema.properties?.[f]?.['x-form-hidden'], true, `${name}.${f}`);
    }
  }
});
