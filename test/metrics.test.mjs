// Prometheus /metrics endpoint (issue #49): default-on, Prometheus format, default Node
// + HTTP + DB + auth metrics, PB_METRICS=0 disables, optional Basic Auth guard.
// Run: node --test test/metrics.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../dist/db/index.js'; // createDb → instrumented Db (records DB metrics)
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.metrics.sqlite');
let db, server, base;

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
const api = (m, p, headers) =>
  fetch(`${base}${p}`, { method: m, headers }).then(async (r) => ({
    status: r.status,
    ct: r.headers.get('content-type'),
    text: await r.text(),
  }));

before(async () => {
  delete process.env.PB_METRICS;
  delete process.env.PB_METRICS_USER;
  delete process.env.PB_METRICS_PASSWORD;
  rmSync(DB, { force: true });
  db = createDb({ dialect: 'sqlite', filename: DB });
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
  delete process.env.PB_METRICS;
  delete process.env.PB_METRICS_USER;
  delete process.env.PB_METRICS_PASSWORD;
});

test('exposes default Node + HTTP + DB + auth metrics in Prometheus format', async () => {
  // some traffic: a list (→ SELECT), and a request with a bad token (→ auth failure)
  await api('GET', '/api/dcim/manufacturers/');
  await api('GET', '/api/dcim/manufacturers/', { Authorization: 'Token wrongkey' });

  const m = await api('GET', '/metrics');
  assert.equal(m.status, 200);
  assert.match(m.ct, /text\/plain; version=0\.0\.4/);
  // default Node runtime metrics (prefixed)
  assert.match(m.text, /paashup_nodejs_/);
  assert.match(m.text, /paashup_process_/);
  // HTTP metrics with the normalized route label (collection endpoint, not the raw path)
  assert.match(
    m.text,
    /paashup_http_requests_total\{[^}]*route="\/api\/dcim\/manufacturers\/"[^}]*\}/,
  );
  assert.match(m.text, /paashup_http_request_duration_seconds_bucket/);
  // DB metrics from the list's SELECT
  assert.match(m.text, /paashup_db_query_duration_seconds_bucket\{[^}]*database="sqlite"/);
  // auth: the wrong token recorded a token failure
  assert.match(m.text, /paashup_auth_attempts_total\{method="token",outcome="failure"\} [1-9]/);
});

test('PB_METRICS=0 disables the endpoint (404)', async () => {
  process.env.PB_METRICS = '0';
  try {
    const m = await api('GET', '/metrics');
    assert.equal(m.status, 404);
  } finally {
    delete process.env.PB_METRICS;
  }
});

test('optional HTTP Basic Auth guards the endpoint when configured', async () => {
  process.env.PB_METRICS_USER = 'prom';
  process.env.PB_METRICS_PASSWORD = 's3cret';
  try {
    assert.equal((await api('GET', '/metrics')).status, 401); // no creds
    assert.equal(
      (await api('GET', '/metrics', { Authorization: basic('prom', 'nope') })).status,
      401,
    );
    assert.equal(
      (await api('GET', '/metrics', { Authorization: basic('prom', 's3cret') })).status,
      200,
    );
  } finally {
    delete process.env.PB_METRICS_USER;
    delete process.env.PB_METRICS_PASSWORD;
  }
});
