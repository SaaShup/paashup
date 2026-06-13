// Multi-provider SSO via the Backend-for-Frontend exchange. A local HTTP server stands
// in for the IdP (discovery + JWKS + token endpoint), signing tokens with a throwaway
// RSA key. We configure two providers against it — a Keycloak-style "corp" (roles) and a
// Google-style "gwork" (email/domain) — and drive the real /api/auth endpoints.
// Run: node --test test/oidc-bff.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { _resetOidcCache } from '../dist/oidc.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.oidc-bff.sqlite');
const KID = 'bff-key-1';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64url = (b) => Buffer.from(b).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
function sign(claims) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now(), exp: now() + 300, ...claims }));
  const sig = crypto
    .sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey)
    .toString('base64url');
  return `${head}.${body}.${sig}`;
}

let db, idp, issuer, server, base;
const codes = new Map(); // code -> { id_token, access_token? }  (filled per test)

const exchange = (body) =>
  fetch(`${base}/api/auth/oidc/exchange/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const apiGet = (token) =>
  fetch(`${base}/api/dcim/manufacturers/`, { headers: { Authorization: `Token ${token}` } }).then(
    (r) => r.status,
  );
const apiPost = (token, name) =>
  fetch(`${base}/api/dcim/manufacturers/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
    body: JSON.stringify({ name, slug: name.toLowerCase() }),
  }).then((r) => r.status);

before(async () => {
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  idp = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/openid-configuration') {
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        }),
      );
    }
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }));
    if (req.url === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const f = new URLSearchParams(raw);
        // confidential client (google-style) must send the secret; public must send PKCE
        if (f.get('client_id') === 'gclient' && f.get('client_secret') !== 'gsecret') {
          res.writeHead(401);
          return res.end(JSON.stringify({ error: 'invalid_client' }));
        }
        if (f.get('client_id') === 'paasbox' && !f.get('code_verifier')) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'missing PKCE verifier' }));
        }
        const tok = codes.get(f.get('code'));
        if (!tok) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'invalid_grant' }));
        }
        return res.end(JSON.stringify({ token_type: 'Bearer', expires_in: 300, ...tok }));
      });
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${idp.address().port}`;

  process.env.PB_OIDC_PROVIDERS = 'corp,gwork';
  // corp: Keycloak-style (roles), public PKCE client
  process.env.PB_OIDC_CORP_ISSUER = issuer;
  process.env.PB_OIDC_CORP_CLIENT_ID = 'paasbox';
  process.env.PB_OIDC_CORP_AUDIENCE = 'paasbox';
  process.env.PB_OIDC_CORP_WRITE_ROLE = 'paasbox-write';
  process.env.PB_OIDC_CORP_KIND = 'oidc';
  // gwork: Google-style (email/domain), confidential client with a secret
  process.env.PB_OIDC_GWORK_ISSUER = issuer;
  process.env.PB_OIDC_GWORK_CLIENT_ID = 'gclient';
  process.env.PB_OIDC_GWORK_CLIENT_SECRET = 'gsecret';
  process.env.PB_OIDC_GWORK_KIND = 'google';
  process.env.PB_OIDC_GWORK_ALLOWED_DOMAINS = 'saashup.com';
  process.env.PB_OIDC_GWORK_WRITE_EMAILS = 'admin@saashup.com';
  _resetOidcCache();

  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  server = createApiServer({ db, auth: { required: true }, realtime: false });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => idp.close(r));
  await db.close();
  rmSync(DB, { force: true });
  for (const k of Object.keys(process.env)) if (k.startsWith('PB_OIDC')) delete process.env[k];
});

test('GET /api/auth/providers/ lists both providers with an authorization endpoint', async () => {
  const r = await fetch(`${base}/api/auth/providers/`).then((x) => x.json());
  assert.equal(r.login_required, true);
  const ids = r.providers.map((p) => p.id).sort();
  assert.deepEqual(ids, ['corp', 'gwork']);
  for (const p of r.providers) {
    assert.ok(p.authorization_endpoint, `${p.id} has an authorization endpoint`);
    assert.ok(!('client_secret' in p), 'no secret leaks to the SPA');
  }
});

test('Keycloak-style: code exchange verifies id_token and grants write via role', async () => {
  codes.set('corp-w', {
    id_token: sign({
      iss: issuer,
      aud: 'paasbox',
      preferred_username: 'alice',
      email: 'alice@corp',
    }),
    access_token: sign({ iss: issuer, aud: 'paasbox', realm_access: { roles: ['paasbox-write'] } }),
  });
  const r = await exchange({
    provider: 'corp',
    code: 'corp-w',
    code_verifier: 'v',
    redirect_uri: 'http://x/',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.write_enabled, true);
  assert.equal(r.body.username, 'alice');
  assert.equal(await apiGet(r.body.token), 200);
  assert.equal(await apiPost(r.body.token, 'KcWrite'), 201);
});

test('Keycloak-style: no role ⇒ read-only paas2box token', async () => {
  codes.set('corp-ro', {
    id_token: sign({ iss: issuer, aud: 'paasbox', preferred_username: 'bob' }),
    access_token: sign({ iss: issuer, aud: 'paasbox', realm_access: { roles: ['viewer'] } }),
  });
  const r = await exchange({
    provider: 'corp',
    code: 'corp-ro',
    code_verifier: 'v',
    redirect_uri: 'http://x/',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.write_enabled, false);
  assert.equal(await apiGet(r.body.token), 200);
  assert.equal(await apiPost(r.body.token, 'KcRo'), 403);
});

test('Google-style: allowed domain + write email ⇒ write; the exchange sends the client secret', async () => {
  codes.set('g-admin', {
    id_token: sign({
      iss: issuer,
      aud: 'gclient',
      email: 'admin@saashup.com',
      email_verified: true,
    }),
    access_token: 'opaque-google-token', // not a JWT, like real Google — must be ignored
  });
  const r = await exchange({ provider: 'gwork', code: 'g-admin', redirect_uri: 'http://x/' });
  assert.equal(r.status, 200);
  assert.equal(r.body.username, 'admin@saashup.com');
  assert.equal(r.body.write_enabled, true);
  assert.equal(await apiPost(r.body.token, 'GAdmin'), 201);
});

test('Google-style: allowed domain but not a write email ⇒ read-only', async () => {
  codes.set('g-user', {
    id_token: sign({
      iss: issuer,
      aud: 'gclient',
      email: 'user@saashup.com',
      email_verified: true,
    }),
  });
  const r = await exchange({ provider: 'gwork', code: 'g-user', redirect_uri: 'http://x/' });
  assert.equal(r.status, 200);
  assert.equal(r.body.write_enabled, false);
  assert.equal(await apiGet(r.body.token), 200);
  assert.equal(await apiPost(r.body.token, 'GUser'), 403);
});

test('Google-style: a disallowed domain is rejected (403, no token)', async () => {
  codes.set('g-evil', {
    id_token: sign({
      iss: issuer,
      aud: 'gclient',
      email: 'mallory@evil.com',
      email_verified: true,
    }),
  });
  const r = await exchange({ provider: 'gwork', code: 'g-evil', redirect_uri: 'http://x/' });
  assert.equal(r.status, 403);
  assert.ok(!r.body.token);
  assert.match(r.body.detail, /not allowed/i);
});

test('unknown provider or bad code is rejected', async () => {
  assert.equal(
    (await exchange({ provider: 'nope', code: 'x', redirect_uri: 'http://x/' })).status,
    400,
  );
  const bad = await exchange({
    provider: 'corp',
    code: 'does-not-exist',
    code_verifier: 'v',
    redirect_uri: 'http://x/',
  });
  assert.equal(bad.status, 401); // token endpoint rejected the grant
});
