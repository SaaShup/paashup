// Webhook credentials: a delivery can carry a credential two ways —
//   1. a token in the payload_url query string (sent verbatim), and
//   2. an Authorization (or any) header via `additional_headers`.
// (HTTP basic-auth userinfo in the URL — https://user:pass@host — is rejected by
//  Node's fetch, so the header form is the supported way; see also the HMAC secret.)
// Run: node --test test/webhook-credentials.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.wh-cred.sqlite');
let db, server, base, recv, recvBase;
const recvd = []; // { url, headers, json }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function waitFor(pred, label) {
  for (let i = 0; i < 120; i++) {
    const hit = recvd.find(pred);
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error(`webhook never arrived: ${label}`);
}

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
  db.exec(
    readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
  );

  recv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      recvd.push({ url: req.url, headers: req.headers, json: raw ? JSON.parse(raw) : null });
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  recvBase = `http://127.0.0.1:${recv.address().port}`;

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // 1) credential as a query-string token in the payload_url
  await api('POST', '/api/extras/webhooks/', {
    name: 'cred-query',
    payload_url: `${recvBase}/q?token=tok-abc123`,
    object_types: ['dcim.manufacturer'],
    events: ['created'],
  });
  // 2) credential(s) as request headers via additional_headers (one "Header: value" per line)
  await api('POST', '/api/extras/webhooks/', {
    name: 'cred-header',
    payload_url: `${recvBase}/h`,
    object_types: ['dcim.manufacturer'],
    events: ['created'],
    additional_headers: 'Authorization: Bearer my-bearer-token\nX-Api-Key: key-987',
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => recv.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('payload_url query-string credential is delivered verbatim', async () => {
  await api('POST', '/api/dcim/manufacturers/', { name: 'QCorp', slug: 'qcorp' });
  const hit = await waitFor((r) => r.url.startsWith('/q'), 'query-token delivery');
  // the token survives end to end in the request URL
  assert.match(hit.url, /[?&]token=tok-abc123\b/);
  assert.equal(hit.json.event, 'created');
  assert.equal(hit.json.data.slug, 'qcorp');
});

test('additional_headers credential is sent as a request header', async () => {
  await api('POST', '/api/dcim/manufacturers/', { name: 'HCorp', slug: 'hcorp' });
  const hit = await waitFor(
    (r) => r.url === '/h' && r.json?.data?.slug === 'hcorp',
    'header-auth delivery',
  );
  assert.equal(hit.headers['authorization'], 'Bearer my-bearer-token');
  assert.equal(hit.headers['x-api-key'], 'key-987');
});
