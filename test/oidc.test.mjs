// Native OIDC (Keycloak) auth: validate Bearer JWTs against the issuer's JWKS,
// map claims to an auto-provisioned local user, and derive write access from a role.
// A local HTTP server stands in for Keycloak's discovery + JWKS endpoints, and we
// sign tokens with a throwaway RSA key — no live Keycloak needed.
// Run: node --test test/oidc.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { authenticate } from '../dist/auth.js';
import { _resetOidcCache } from '../dist/oidc.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.oidc.sqlite');
const KID = 'test-key-1';
let db, idp, issuer;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64url = (b) => Buffer.from(b).toString('base64url');
function mkToken(claims, { key = privateKey, kid = KID } = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
function claims(over = {}) {
  return {
    iss: issuer,
    aud: 'paasbox',
    exp: now() + 300,
    iat: now(),
    preferred_username: 'alice',
    email: 'alice@example.com',
    given_name: 'Alice',
    family_name: 'Liddell',
    realm_access: { roles: ['paasbox-write'] },
    ...over,
  };
}

before(async () => {
  // stand-in Keycloak: discovery + JWKS
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  idp = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') {
      return res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    }
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${idp.address().port}`;

  process.env.PB_OIDC_ISSUER = issuer;
  process.env.PB_OIDC_AUDIENCE = 'paasbox';
  process.env.PB_OIDC_WRITE_ROLE = 'paasbox-write';
  _resetOidcCache();

  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0011_users_oidc_subject.sqlite.sql'), 'utf8'));
});

after(async () => {
  await new Promise((r) => idp.close(r));
  await db.close();
  rmSync(DB, { force: true });
  delete process.env.PB_OIDC_ISSUER;
  delete process.env.PB_OIDC_AUDIENCE;
  delete process.env.PB_OIDC_WRITE_ROLE;
});

test('valid Bearer token authenticates, auto-provisions the user, grants write via role', async () => {
  const ctx = await authenticate(db, `Bearer ${mkToken(claims())}`);
  assert.ok(ctx, 'expected an auth context');
  assert.equal(ctx.writeEnabled, true);
  const u = await db.get('SELECT username, email, is_active FROM users_user WHERE id = ?', [
    ctx.userId,
  ]);
  assert.equal(u.username, 'alice');
  assert.equal(u.email, 'alice@example.com');
  assert.equal(u.is_active, 1);
});

test('same subject reuses the provisioned user (no duplicate)', async () => {
  const a = await authenticate(db, `Bearer ${mkToken(claims())}`);
  const b = await authenticate(db, `Bearer ${mkToken(claims())}`);
  assert.equal(a.userId, b.userId);
  const n = await db.get("SELECT COUNT(*) AS c FROM users_user WHERE username = 'alice'");
  assert.equal(n.c, 1);
});

test('missing the write role ⇒ read-only', async () => {
  const ctx = await authenticate(
    db,
    `Bearer ${mkToken(claims({ preferred_username: 'bob', realm_access: { roles: ['viewer'] } }))}`,
  );
  assert.ok(ctx);
  assert.equal(ctx.writeEnabled, false);
});

test('client roles (resource_access) are honored too', async () => {
  const ctx = await authenticate(
    db,
    `Bearer ${mkToken(
      claims({
        preferred_username: 'carol',
        realm_access: { roles: [] },
        resource_access: { paasbox: { roles: ['paasbox-write'] } },
      }),
    )}`,
  );
  assert.equal(ctx.writeEnabled, true);
});

test('a tampered signature is rejected', async () => {
  const tok = mkToken(claims());
  const bad = tok.slice(0, -3) + (tok.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  assert.equal(await authenticate(db, `Bearer ${bad}`), null);
});

test('expired / wrong-issuer / wrong-audience tokens are rejected', async () => {
  assert.equal(await authenticate(db, `Bearer ${mkToken(claims({ exp: now() - 3600 }))}`), null);
  assert.equal(
    await authenticate(db, `Bearer ${mkToken(claims({ iss: 'https://evil.example' }))}`),
    null,
  );
  assert.equal(
    await authenticate(db, `Bearer ${mkToken(claims({ aud: 'someone-else', azp: 'x' }))}`),
    null,
  );
});

test('a token signed by an unknown key is rejected', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal(await authenticate(db, `Bearer ${mkToken(claims(), { key: other })}`), null);
});

test('static API tokens still parse (Token scheme unaffected)', async () => {
  // no auth_token table here, so a well-formed Token simply resolves to null (not a crash)
  assert.equal(await authenticate(db, 'Token deadbeef'), null);
});
