// Dev helper: run paas2box behind a FAKE OIDC provider so you can click "Sign in"
// in the browser and exercise the SSO login flow without standing up Keycloak.
//
//   npm run build && (cd web && npm run build)      # build backend + SPA once
//   node scripts/dev-fake-sso.mjs                   # then open http://localhost:8000
//
// The fake IdP auto-approves login (no password page) and issues a signed RS256
// token the backend verifies against its JWKS. Configure the fake identity with env:
//   FAKE_USER=demo  FAKE_ROLES=paasbox-write  FAKE_EMAIL=demo@example.test
//   PB_SQLITE_FILE=./paas2box.db  PORT=8000  PB_AUTH_REQUIRED=1
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8000);
const USER = process.env.FAKE_USER ?? 'demo';
const ROLES = (process.env.FAKE_ROLES ?? 'paasbox-write').split(',').map((s) => s.trim()).filter(Boolean);
const EMAIL = process.env.FAKE_EMAIL ?? `${USER}@example.test`;
const AUD = 'paasbox-spa';

// --- fake OIDC provider (discovery + JWKS + auto-login + token) ---
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'fake-kid';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (claims) => {
  const h = b64(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const p = b64(JSON.stringify(claims));
  const s = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
};

let idpUrl = '';
const idp = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  const u = new URL(req.url, idpUrl);
  if (u.pathname === '/.well-known/openid-configuration') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({
      issuer: idpUrl,
      authorization_endpoint: `${idpUrl}/auth`,
      token_endpoint: `${idpUrl}/token`,
      jwks_uri: `${idpUrl}/jwks`,
      end_session_endpoint: `${idpUrl}/logout`,
    }));
  }
  if (u.pathname === '/jwks') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ keys: [jwk] }));
  }
  if (u.pathname === '/auth') {
    // auto-approve: bounce straight back with an authorization code
    const redirect = u.searchParams.get('redirect_uri');
    const state = u.searchParams.get('state') ?? '';
    res.writeHead(302, { location: `${redirect}?code=fake&state=${encodeURIComponent(state)}` });
    return res.end();
  }
  if (u.pathname === '/token') {
    const now = Math.floor(Date.now() / 1000);
    const tok = sign({
      iss: idpUrl, aud: AUD, azp: AUD, exp: now + 300, iat: now,
      preferred_username: USER, email: EMAIL, given_name: USER, family_name: 'SSO',
      realm_access: { roles: ROLES },
    });
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({
      access_token: tok, id_token: tok, refresh_token: 'fake-refresh', token_type: 'Bearer', expires_in: 300,
    }));
  }
  if (u.pathname === '/logout') {
    res.writeHead(302, { location: u.searchParams.get('post_logout_redirect_uri') || '/' });
    return res.end();
  }
  res.writeHead(404);
  res.end('{}');
});
await new Promise((r) => idp.listen(0, '127.0.0.1', r));
idpUrl = `http://127.0.0.1:${idp.address().port}`;

// --- paas2box, wired to the fake IdP ---
process.env.PB_OIDC_ISSUER = idpUrl;
process.env.PB_OIDC_AUDIENCE = AUD;
process.env.PB_OIDC_WRITE_ROLE = 'paasbox-write';
process.env.PB_OIDC_CLIENT_ID = AUD;

const dbFile = process.env.PB_SQLITE_FILE ?? join(ROOT, 'paas2box.db');
const db = new SqliteDb(dbFile);
if (!existsSync(dbFile) || dbFile === ':memory:') {
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
}
const webRoot = join(ROOT, 'web', 'dist');
const server = createApiServer({
  db,
  webRoot: existsSync(webRoot) ? webRoot : undefined,
  auth: { required: process.env.PB_AUTH_REQUIRED === '1' },
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

console.log(`\n  fake OIDC provider : ${idpUrl}`);
console.log(`  paas2box           : http://localhost:${PORT}/`);
console.log(`  will sign you in as : ${USER}  (roles: ${ROLES.join(', ') || 'none'})`);
console.log(`  auth required       : ${process.env.PB_AUTH_REQUIRED === '1'}`);
console.log(`\n  Open http://localhost:${PORT}/ and click "Sign in".  Ctrl-C to stop.\n`);
