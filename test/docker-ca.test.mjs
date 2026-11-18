// TLS CA pinning for Docker agents (trust-on-first-use): adding an https host fetches and
// stores the agent's self-signed CA (src/plugins/docker/tls.ts), every later call is pinned
// to exactly that CA, a different self-signed CA (even one with a technically valid chain
// of its own) is refused, editing the endpoint re-pins, and a pinned delivery that can't
// reach any HTTP response at all (CA mismatch, not an application-level error) leaves a
// "danger" journal entry on the host instead of only a server console log.
// Run: node --test test/docker-ca.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { createApiServer } from '../dist/api/server.js';
import { ensureWebhooks } from '../dist/webhooks.js';
import dockerPlugin from '../dist/plugins/docker/index.js';
import { DOCKER_WEBHOOKS } from '../dist/plugins/docker/webhooks.js';

const exec = promisify(execFile);
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.docker-ca.sqlite');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let db, server, base, agentServer, agentPort, agentEndpoint, certDir;

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

/** A fresh self-signed CA+leaf (SAN 127.0.0.1), as the agent would generate on first boot. */
async function generateCert(cn) {
  const key = join(certDir, `${cn}.key.pem`);
  const cert = join(certDir, `${cn}.cert.pem`);
  await exec('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-nodes',
    '-subj',
    `/CN=${cn}`,
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ]);
  return { key: readFileSync(key), cert: readFileSync(cert), pem: readFileSync(cert, 'utf8') };
}

/** Swap the fake agent's TLS identity in place (same host:port) — simulates a CA rotation
 *  (redeploy, lost /data/tls) without restarting the listener. */
function rotateAgentCert(cn) {
  return generateCert(cn).then((c) => {
    agentServer.setSecureContext({ key: c.key, cert: c.cert });
    agentServer.currentPem = c.pem;
    return c;
  });
}

before(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'docker-ca-test-'));
  const initial = await generateCert('agentA');

  agentServer = https.createServer({ key: initial.key, cert: initial.cert }, (req, res) => {
    // No keep-alive: each request opens a fresh connection, so a rotated cert is actually
    // re-presented (and re-validated) on the very next call instead of reusing an
    // already-established TLS session from before the rotation.
    res.setHeader('Connection', 'close');
    if (req.url === '/api/tls/certificate') {
      res.writeHead(200, { 'content-type': 'application/x-pem-file' });
      return res.end(agentServer.currentPem);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
  agentServer.currentPem = initial.pem;
  await new Promise((r) => agentServer.listen(0, '127.0.0.1', r));
  agentPort = agentServer.address().port;
  agentEndpoint = `https://127.0.0.1:${agentPort}`;

  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
  db.exec(
    readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
  );
  db.exec(readFileSync(join(ROOT, 'migrations', '0008_journalentry.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0010_webhook_template.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin]);
  await ensureWebhooks(db, DOCKER_WEBHOOKS); // seeds "[Docker] Modify host" etc.

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.BASE_URL = base;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => agentServer.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
  rmSync(certDir, { recursive: true, force: true });
});

let hostId, imageId;

test('adding an https host pins the agent CA via trust-on-first-use, never exposed via the API', async () => {
  const r = await api('POST', '/api/plugins/docker/hosts/', {
    endpoint: agentEndpoint,
    name: 'ca-host',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  hostId = r.body.id;
  assert.equal('ca_pem' in r.body, false); // sensitive column, not a registered field

  const row = await db.get('SELECT ca_pem FROM plugin_docker_host WHERE id = ?', [hostId]);
  assert.ok(row.ca_pem?.includes('BEGIN CERTIFICATE'), 'CA not pinned on create');

  const reg = (
    await api('POST', '/api/plugins/docker/registries/', {
      host: hostId,
      name: 'r',
      serveraddress: 'https://x/v2/',
    })
  ).body;
  imageId = (
    await api('POST', '/api/plugins/docker/images/', {
      host: hostId,
      registry: reg.id,
      name: 'nginx',
    })
  ).body.id;
});

test('a proxied action against the host succeeds over https using the pinned CA', async () => {
  const r = await api('POST', `/api/plugins/docker/images/${imageId}/force_pull/`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.success, true);
});

test('a different self-signed CA (rotated agent) is refused, even though it is technically valid on its own', async () => {
  await rotateAgentCert('agentB');
  const r = await api('POST', `/api/plugins/docker/images/${imageId}/force_pull/`);
  assert.equal(r.status, 502, JSON.stringify(r.body));
});

test('editing the endpoint re-pins the agent CA (recovers from the rotation above)', async () => {
  const r = await api('PATCH', `/api/plugins/docker/hosts/${hostId}/`, { endpoint: agentEndpoint });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const row = await db.get('SELECT ca_pem FROM plugin_docker_host WHERE id = ?', [hostId]);
  assert.ok(row.ca_pem?.includes('BEGIN CERTIFICATE'));

  const r2 = await api('POST', `/api/plugins/docker/images/${imageId}/force_pull/`);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
});

test('a bare refresh does NOT re-pin (only create / an explicit endpoint edit do)', async () => {
  await rotateAgentCert('agentC'); // rotate again, without editing `endpoint`
  const before_ = await db.get('SELECT ca_pem FROM plugin_docker_host WHERE id = ?', [hostId]);

  await api('PATCH', `/api/plugins/docker/hosts/${hostId}/`, { operation: 'refresh' });

  const after_ = await db.get('SELECT ca_pem FROM plugin_docker_host WHERE id = ?', [hostId]);
  assert.equal(after_.ca_pem, before_.ca_pem, 'a bare refresh must not touch the pinned CA');
});

test('a pinned delivery that never gets an HTTP response journals a "danger" entry on the host', async () => {
  // The CA is now stale (rotated to agentC above, never re-pinned) — "[Docker] Modify host"
  // (fires on the 'updated' event, which the refresh above also triggered) must have failed
  // purely on TLS, and that failure must be visible on the host's journal.
  let entry;
  for (let i = 0; i < 100 && !entry; i++) {
    const rows = await db.query(
      `SELECT * FROM extras_journalentry
        WHERE assigned_object_type = 'plugins.dockerhost' AND assigned_object_id = ? AND kind = 'danger'
        ORDER BY id DESC LIMIT 1`,
      [hostId],
    );
    entry = rows[0];
    if (!entry) await sleep(50);
  }
  assert.ok(entry, 'no CA-failure journal entry was written');
  assert.match(entry.comments, /pinned CA/i);

  // and the direct proxied action keeps failing too, for the same reason
  const r = await api('POST', `/api/plugins/docker/images/${imageId}/force_pull/`);
  assert.equal(r.status, 502, JSON.stringify(r.body));
});

test('switching the host to a plain http endpoint clears the pinned CA', async () => {
  await api('PATCH', `/api/plugins/docker/hosts/${hostId}/`, { endpoint: 'http://127.0.0.1:1' });
  const row = await db.get('SELECT ca_pem FROM plugin_docker_host WHERE id = ?', [hostId]);
  assert.equal(row.ca_pem, null);
});
