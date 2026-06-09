// NetBox-compatibility additions used by clients like the Docker agent:
//   - bulk update: PATCH/PUT a collection with a list of objects (each with an id)
//   - lenient sync: extra/nested fields (e.g. an FK sent as an object) are ignored
//   - /api/extras/journal-entries/ (a permissive journal entity)
// Run: node --test test/bulk-journal.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.bulkjournal.sqlite');
let db, server, base;

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

before(async () => {
  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  db.exec(readFileSync(join(ROOT, 'migrations', '0008_journalentry.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

test('bulk PATCH a collection updates each object by id', async () => {
  const a = await api('POST', '/api/dcim/manufacturers/', { name: 'A', slug: 'a' });
  const b = await api('POST', '/api/dcim/manufacturers/', { name: 'B', slug: 'b' });
  const r = await api('PATCH', '/api/dcim/manufacturers/', [
    { id: a.body.id, description: 'aa' },
    { id: b.body.id, description: 'bb' },
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.length, 2);
  assert.equal((await api('GET', `/api/dcim/manufacturers/${a.body.id}/`)).body.description, 'aa');
  assert.equal((await api('GET', `/api/dcim/manufacturers/${b.body.id}/`)).body.description, 'bb');
});

test('bulk update is lenient: nested FK objects + unknown fields are ignored', async () => {
  const region = await api('POST', '/api/dcim/regions/', { name: 'R', slug: 'r' });
  const site = await api('POST', '/api/dcim/sites/', { name: 'S', slug: 's', status: 'active' });
  // mimic an agent writeback: scalar field + an FK given as an object + extra/observed keys
  const r = await api('PATCH', '/api/dcim/sites/', [
    {
      id: site.body.id,
      description: 'synced',
      region: { id: region.body.id, name: 'R' }, // FK as object -> coerced to id
      observed_only: 'ignore-me', // unknown key -> ignored
      tags: [{ name: 'x' }], // relation array -> ignored here
    },
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = await api('GET', `/api/dcim/sites/${site.body.id}/`);
  assert.equal(got.body.description, 'synced');
  assert.equal(got.body.region?.id, region.body.id);
});

test('bulk update requires an id per item', async () => {
  const r = await api('PATCH', '/api/dcim/manufacturers/', [{ description: 'no id' }]);
  assert.equal(r.status, 400);
});

test('journal entries can be created and listed', async () => {
  const r = await api('POST', '/api/extras/journal-entries/', {
    assigned_object_type: 'dcim.device',
    assigned_object_id: 1,
    kind: 'info',
    comments: 'created by agent',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.comments, 'created by agent');
  const list = await api('GET', '/api/extras/journal-entries/');
  assert.equal(list.status, 200);
  assert.ok(list.body.count >= 1);
});
