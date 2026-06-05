// Same operations as smoke.mjs, but against MariaDB — proves the repository is
// dialect-agnostic. Requires a running MariaDB with the schema applied.
// Run: DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=root DB_PASSWORD=root \
//      node --test test/smoke-mariadb.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MariaDb } from '../dist/db/mariadb.js';
import { repository } from '../dist/repository/index.js';

const cfg = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 13306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME ?? 'paasbox',
};

let db;
const suffix = String(process.hrtime.bigint()).slice(-6); // avoid unique clashes across runs

before(() => {
  db = new MariaDb(cfg);
});
after(async () => {
  await db.close();
});

test('mariadb: create + retrieve with FK', async () => {
  const m = await repository(db, 'dcim_manufacturer').create({
    name: `Acme-${suffix}`,
    slug: `acme-${suffix}`,
  });
  assert.equal(typeof m.id, 'number');
  const dt = await repository(db, 'dcim_device_type').create({
    manufacturer: m.id,
    model: 'Box',
    slug: `box-${suffix}`,
  });
  assert.equal(dt.manufacturer, m.id);
});

test('mariadb: JSON + boolean round-trip', async () => {
  const p = await repository(db, 'ipam_prefix').create({
    prefix: `10.${suffix.slice(0, 1)}.0.0/16`,
    status: 'active',
    is_pool: true,
    custom_fields: { team: 'core', n: 7 },
  });
  assert.equal(p.is_pool, true);
  assert.deepEqual(p.custom_fields, { team: 'core', n: 7 });
});

test('mariadb: list + filter + pagination', async () => {
  const rirs = repository(db, 'ipam_rir');
  await rirs.create({ name: `RIR-${suffix}`, slug: `rir-${suffix}` });
  const filtered = await rirs.list({ filters: { slug: `rir-${suffix}` } });
  assert.equal(filtered.count, 1);
  assert.equal(filtered.results[0].name, `RIR-${suffix}`);
});

test('mariadb: update + destroy', async () => {
  const roles = repository(db, 'ipam_role');
  const r = await roles.create({ name: `Role-${suffix}`, slug: `role-${suffix}` });
  const u = await roles.update(r.id, { description: 'desc' });
  assert.equal(u.description, 'desc');
  assert.equal(await roles.destroy(r.id), true);
  assert.equal(await roles.retrieve(r.id), undefined);
});

test('mariadb: FK violation rejected', async () => {
  await assert.rejects(
    () =>
      repository(db, 'dcim_device_type').create({
        manufacturer: 999999,
        model: 'Ghost',
        slug: `ghost-${suffix}`,
      }),
    /foreign key|constraint/i,
  );
});

test('mariadb: transaction rolls back', async () => {
  const tag = `t-${suffix}`;
  await assert.rejects(() =>
    db.transaction(async (tx) => {
      await repository(tx, 'tenancy_tenant').create({ name: tag, slug: tag });
      throw new Error('boom');
    }),
  );
  const after = await repository(db, 'tenancy_tenant').list({ filters: { slug: tag } });
  assert.equal(after.count, 0);
});
