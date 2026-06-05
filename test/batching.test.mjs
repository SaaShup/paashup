// Proves FK expansion is batched: serializing a list of N rows that each carry
// several FKs costs ~1 query per distinct target table, not N×(#FKs).
// Run: node --test test/batching.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { repository } from '../dist/repository/index.js';
import { Serializer } from '../dist/api/serializer.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.batch.sqlite');

let db;
const N = 100;

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));

  // One shared manufacturer/role/site/type, then N devices referencing them.
  const mfr = await repository(db, 'dcim_manufacturer').create({ name: 'Acme', slug: 'acme' });
  const role = await repository(db, 'dcim_device_role').create({ name: 'Leaf', slug: 'leaf' });
  const site = await repository(db, 'dcim_site').create({
    name: 'DC1',
    slug: 'dc1',
    status: 'active',
  });
  const dt = await repository(db, 'dcim_device_type').create({
    manufacturer: mfr.id,
    model: 'X',
    slug: 'x',
  });
  const devices = repository(db, 'dcim_device');
  for (let i = 0; i < N; i++) {
    await devices.create({
      name: `dev${i}`,
      device_type: dt.id,
      role: role.id,
      site: site.id,
      status: 'active',
    });
  }
});

after(async () => {
  await db.close();
  rmSync(DB_FILE, { force: true });
});

test('device serialization query count is independent of row count (no N+1)', async () => {
  const devices = repository(db, 'dcim_device');
  const ser = new Serializer(db, 'http://t');

  const page10 = await devices.list({ limit: 10 });
  db.queries = 0;
  await new Serializer(db, 'http://t').objects('dcim_device', page10.results);
  const q10 = db.queries;

  const page100 = await devices.list({ limit: 1000 });
  assert.equal(page100.results.length, N);
  db.queries = 0;
  const out = await ser.objects('dcim_device', page100.results);
  const q100 = db.queries;

  // FKs expanded to nested briefs.
  assert.equal(out[0].device_type.display, 'X');
  assert.equal(out[0].role.display, 'Leaf');
  assert.equal(out[0].site.display, 'DC1');

  // The invariant: serializing 100 rows costs the SAME number of queries as 10
  // (FK briefs + relations + counts are each one batched query) — O(1) in N.
  assert.equal(q100, q10, `query count must not grow with rows: 10 rows=${q10}, 100 rows=${q100}`);
  console.log(`  serialized 10 and ${N} devices in ${q10} queries each (constant in N)`);
});

test('batched output is identical to per-row serialization', async () => {
  const devices = repository(db, 'dcim_device');
  const page = await devices.list({ limit: 5 });

  const batched = await new Serializer(db, 'http://t').objects('dcim_device', page.results);
  // Serialize each row with its own fresh serializer (no shared cache) = the
  // unbatched path; results must match the batched ones exactly.
  const perRow = [];
  for (const r of page.results)
    perRow.push(await new Serializer(db, 'http://t').object('dcim_device', r));

  assert.deepEqual(batched, perRow);
});
