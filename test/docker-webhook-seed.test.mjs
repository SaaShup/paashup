// Startup seeding of the Docker agent webhooks: ensureWebhooks creates any that are
// missing (matched by name), is idempotent, recreates a deleted one, and never
// touches an existing one. Run: node --test test/docker-webhook-seed.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { ensureWebhooks } from '../dist/webhooks.js';
import { DOCKER_WEBHOOKS } from '../dist/plugins/docker/webhooks.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.wh-seed.sqlite');
let db;

before(() => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  for (const m of ['0003_webhook', '0004_webhook_conditions_delivery', '0010_webhook_template'])
    db.exec(readFileSync(join(ROOT, 'migrations', `${m}.sqlite.sql`), 'utf8'));
});
after(async () => {
  await db.close();
  rmSync(DB, { force: true });
});

const count = async () => (await db.query('SELECT COUNT(*) AS n FROM extras_webhook'))[0].n;
const byName = async (name) =>
  (await db.query('SELECT * FROM extras_webhook WHERE name = ?', [name]))[0];

test('ensureWebhooks creates all docker webhooks on first run', async () => {
  assert.equal(await count(), 0);
  await ensureWebhooks(db, DOCKER_WEBHOOKS);
  assert.equal(await count(), DOCKER_WEBHOOKS.length);

  // a representative row is mapped correctly (object_types/events as JSON, ssl off)
  const addHost = await byName('[Docker] Add host');
  assert.equal(addHost.http_method, 'GET');
  assert.equal(addHost.enabled, 1);
  assert.equal(addHost.ssl_verification, 0);
  assert.deepEqual(JSON.parse(addHost.object_types), ['plugins.dockerhost']);
  assert.deepEqual(JSON.parse(addHost.events), ['created']);
  assert.match(addHost.payload_url, /^\{\{ data\.endpoint \}\}\/api\/engine\/endpoint\?id=/);
});

test('ensureWebhooks is idempotent (second run creates nothing)', async () => {
  await ensureWebhooks(db, DOCKER_WEBHOOKS);
  assert.equal(await count(), DOCKER_WEBHOOKS.length);
});

test('a deleted webhook is recreated on the next run', async () => {
  await db.execute('DELETE FROM extras_webhook WHERE name = ?', ['[Docker] Add image']);
  assert.equal(await count(), DOCKER_WEBHOOKS.length - 1);
  await ensureWebhooks(db, DOCKER_WEBHOOKS);
  assert.equal(await count(), DOCKER_WEBHOOKS.length);
  assert.ok(await byName('[Docker] Add image'));
});

test('an existing webhook is left untouched (operator edits preserved)', async () => {
  await db.execute('UPDATE extras_webhook SET payload_url = ? WHERE name = ?', [
    'http://edited.example/hook',
    '[Docker] Add volume',
  ]);
  await ensureWebhooks(db, DOCKER_WEBHOOKS);
  const row = await byName('[Docker] Add volume');
  assert.equal(row.payload_url, 'http://edited.example/hook'); // not overwritten
});
