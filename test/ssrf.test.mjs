// Hardening: SSRF egress guard, webhook-template ReDoS resistance, and baseline
// security headers. Run: node --test test/ssrf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAllowedUrl } from '../dist/ssrf.js';
import { renderTemplate } from '../dist/webhooks.js';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

test('SSRF guard blocks metadata/link-local + bad schemes, allows loopback by default', async () => {
  await assert.rejects(
    assertAllowedUrl('http://169.254.169.254/latest/meta-data/'),
    /SSRF|blocked/,
  );
  await assert.rejects(assertAllowedUrl('http://169.254.170.2/'), /blocked/); // ECS metadata
  await assert.rejects(assertAllowedUrl('ftp://example.com/'), /scheme/);
  await assert.rejects(assertAllowedUrl('file:///etc/passwd'), /scheme/);
  await assert.rejects(assertAllowedUrl('not-a-url'), /invalid/);
  // loopback/private allowed by default so internal webhooks + dev keep working
  await assert.doesNotReject(assertAllowedUrl('http://127.0.0.1:9000/hook'));
  await assert.doesNotReject(assertAllowedUrl('http://10.0.0.5/x'));
});

test('PB_SSRF_BLOCK_PRIVATE=1 also blocks loopback + RFC1918', async () => {
  process.env.PB_SSRF_BLOCK_PRIVATE = '1';
  try {
    await assert.rejects(assertAllowedUrl('http://127.0.0.1/x'), /blocked/);
    await assert.rejects(assertAllowedUrl('http://10.0.0.5/x'), /blocked/);
    await assert.rejects(assertAllowedUrl('http://192.168.1.1/x'), /blocked/);
    await assert.rejects(assertAllowedUrl('http://172.16.0.9/x'), /blocked/);
    // public is still fine (IP literal, no DNS)
    await assert.doesNotReject(assertAllowedUrl('http://8.8.8.8/x'));
  } finally {
    delete process.env.PB_SSRF_BLOCK_PRIVATE;
  }
});

test('renderTemplate is not ReDoS-prone on a pathological filter', () => {
  // 8k spaces inside a filter arg — catastrophic for the old regex, linear now.
  const tpl = `{{ x | a(${' '.repeat(8000)}) }}`;
  const start = process.hrtime.bigint();
  const out = renderTemplate(tpl, { x: 'v' });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 500, `render took ${ms}ms — possible ReDoS`);
  assert.equal(typeof out, 'string');
  // sanity: the documented filters still work
  assert.equal(renderTemplate('{{ x | upper }}', { x: 'hi' }), 'HI');
  assert.equal(renderTemplate("{{ y | default('n/a') }}", {}), 'n/a');
});

test('API responses carry baseline security headers', async () => {
  const DB = join(ROOT, 'test', '.ssrf.sqlite');
  rmSync(DB, { force: true });
  const db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  const server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/status/`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  } finally {
    await new Promise((r) => server.close(r));
    await db.close();
    rmSync(DB, { force: true });
  }
});
