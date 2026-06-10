// Webhook coverage: prove a change on EVERY writable core object type fires a webhook.
//
// A wildcard webhook (object_types: ["*"], events: ["created"]) is registered, then a
// schema-driven builder creates one instance of every writable core entity — resolving
// required FK prerequisites recursively (Manufacturer -> DeviceType -> Device, etc.).
// For each object actually created, the test asserts a matching delivery arrived. The
// guarantee under test is "no created object type is ever missed" (misses === 0).
//
// Plugin object types are covered separately in test/docker-webhooks.test.mjs.
// Run: node --test test/webhook-coverage.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { allTables, getTable } from '../dist/model/registry.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.wh-cov.sqlite');
// schema.sqlite.sql already has the base/auth/iprange tables; only these entity tables
// are migration-only (mirrors what webhooks/bulk-journal/configcontext tests load).
const MIGRATIONS = [
  '0003_webhook',
  '0004_webhook_conditions_delivery',
  '0008_journalentry',
  '0009_configcontext',
];

let db, server, base, recv, recvBase;
const got = []; // { model, id } per delivery received
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (const m of MIGRATIONS)
    db.exec(readFileSync(join(ROOT, 'migrations', `${m}.sqlite.sql`), 'utf8'));

  recv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        const j = JSON.parse(raw);
        got.push({ model: j.model, id: String(j.object_id) });
      } catch {
        /* ignore */
      }
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  recvBase = `http://127.0.0.1:${recv.address().port}`;

  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await api('POST', '/api/extras/webhooks/', {
    name: 'all',
    payload_url: `${recvBase}/hook`,
    object_types: ['*'],
    events: ['created'],
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => recv.close(r));
  await db.close();
  rmSync(DB, { force: true });
});

// ---- schema-driven create payload builder -------------------------------------
let CTR = 0;
function synth(col, fallbackUrl) {
  if (col.enum && col.enum.length) return col.enum[0];
  if (col.tsKind === 'boolean') return false;
  if (col.tsKind === 'number') return (CTR++ % 4000) + 1;
  if (col.tsKind === 'json') return col.name === 'data' ? {} : [];
  const n = ++CTR;
  if (/url/.test(col.name)) return `${fallbackUrl}/sink`; // keep any created webhook valid
  if (col.name === 'slug') return `s-${n}`;
  if (/color/.test(col.name)) return 'aabbcc';
  return `v${n}`.slice(0, col.maxLength ?? 50);
}

test('a change on every writable core object type fires a webhook', async () => {
  const byModel = new Map(allTables().map((m) => [m.model, m]));
  const made = new Map(); // table -> created id (native type)
  const inProgress = new Set();
  const skipped = [];

  async function ensure(meta) {
    if (made.has(meta.table)) return made.get(meta.table);
    if (inProgress.has(meta.table)) return null; // dependency cycle guard
    inProgress.add(meta.table);
    const body = {};
    for (const c of meta.columns) {
      if (!c.writable) continue;
      if (c.references) {
        if (!c.required) continue;
        const parent = byModel.get(c.references);
        const pid = parent ? await ensure(parent) : null;
        if (pid == null) {
          inProgress.delete(meta.table);
          skipped.push([meta.table, `no parent ${c.references}`]);
          return null;
        }
        body[c.name] = pid; // native id type (number, or uuid string)
      } else if (c.required) {
        body[c.name] = synth(c, recvBase);
      }
    }
    if (Object.keys(body).length === 0) {
      const c = meta.columns.find((x) => x.writable && !x.references);
      if (c) body[c.name] = synth(c, recvBase);
    }
    const r = await api('POST', meta.endpoint, body);
    inProgress.delete(meta.table);
    if (r.status !== 201) {
      skipped.push([meta.table, `POST ${r.status}: ${JSON.stringify(r.body).slice(0, 100)}`]);
      return null;
    }
    made.set(meta.table, r.body.id);
    return r.body.id;
  }

  const core = allTables().filter((m) => m.origin === 'core' && !m.readOnly);
  for (const m of core) await ensure(m);

  // wait for the fire-and-forget deliveries to land
  const created = [...made.entries()].map(([table, id]) => ({
    table,
    id: String(id),
    model: getTable(table).objectType,
  }));
  const missesNow = () =>
    created.filter((c) => !got.some((g) => g.model === c.model && g.id === c.id));
  let misses = created;
  for (let i = 0; i < 120 && misses.length; i++) {
    await sleep(25);
    misses = missesNow();
  }

  // eslint-disable-next-line no-console
  console.log(
    `webhook coverage: ${created.length} object types created ` +
      `(all ${core.length} core writable + prereqs), ${skipped.length} skipped, ` +
      `${got.length} deliveries, ${misses.length} misses`,
  );

  assert.equal(
    misses.length,
    0,
    `object types created but no webhook fired: ${misses.map((m) => m.table).join(', ')}`,
  );
  // guard against a regression that silently creates almost nothing
  assert.ok(created.length >= 60, `only ${created.length} object types exercised`);
});
