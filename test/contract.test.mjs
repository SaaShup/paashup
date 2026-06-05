// Validates live API responses against the actual NetBox OpenAPI read schemas
// (the contract the product promises to keep). Run: node --test test/contract.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.contract.sqlite');
const spec = JSON.parse(readFileSync(join(ROOT, 'openapi', 'netbox-dcim-ipam-virt.openapi.json'), 'utf8'));

// OpenAPI 3.0 `nullable: true` -> JSON-Schema-compatible `anyOf [..., {type:null}]`.
function tx(node) {
  if (Array.isArray(node)) return node.map(tx);
  if (node && typeof node === 'object') {
    if (node.nullable === true) {
      const { nullable, ...rest } = node;
      return { anyOf: [tx(rest), { type: 'null' }] };
    }
    const o = {};
    for (const k of Object.keys(node)) o[k] = tx(node[k]);
    return o;
  }
  return node;
}

const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(tx(spec), 'nb');
const validator = (schemaName) => ajv.compile({ $ref: `nb#/components/schemas/${schemaName}` });

let db, server, base;
const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await db.close(); rmSync(DB_FILE, { force: true }); });

// (endpoint, OpenAPI read-schema component, minimal create body)
const CASES = [
  ['/api/dcim/manufacturers/', 'Manufacturer', { name: 'Acme', slug: 'acme' }],
  ['/api/dcim/platforms/', 'Platform', { name: 'EOS', slug: 'eos' }],
  // color has a `^[0-9a-f]{6}$` pattern, so a conformant create supplies one.
  ['/api/dcim/rack-roles/', 'RackRole', { name: 'Net', slug: 'net', color: 'ff0000' }],
  ['/api/dcim/device-roles/', 'DeviceRole', { name: 'Leaf', slug: 'leaf', color: '00ff00' }],
  ['/api/ipam/rirs/', 'RIR', { name: 'RIPE', slug: 'ripe' }],
  ['/api/ipam/roles/', 'Role', { name: 'Loopbacks', slug: 'lo' }],
  ['/api/ipam/route-targets/', 'RouteTarget', { name: '65000:1' }],
  ['/api/virtualization/cluster-types/', 'ClusterType', { name: 'KVM', slug: 'kvm' }],
  ['/api/virtualization/cluster-groups/', 'ClusterGroup', { name: 'G1', slug: 'g1' }],
];

for (const [endpoint, schema, body] of CASES) {
  test(`${schema} response conforms to OpenAPI schema`, async () => {
    const created = await api('POST', endpoint, body);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const validate = validator(schema);
    const ok = validate(created.body);
    assert.ok(ok, `POST ${schema} schema errors:\n` + JSON.stringify(validate.errors, null, 2));

    const got = await api('GET', `${endpoint}${created.body.id}/`);
    assert.ok(validator(schema)(got.body), 'GET response failed schema validation');
  });
}

test('paginated list envelope conforms', async () => {
  await api('POST', '/api/ipam/rirs/', { name: 'ARIN', slug: 'arin' });
  const r = await api('GET', '/api/ipam/rirs/?limit=5');
  // envelope shape
  assert.equal(typeof r.body.count, 'number');
  assert.ok('next' in r.body && 'previous' in r.body);
  assert.ok(Array.isArray(r.body.results));
  const validate = validator('RIR');
  for (const item of r.body.results) {
    assert.ok(validate(item), 'list item failed: ' + JSON.stringify(validate.errors));
  }
});
