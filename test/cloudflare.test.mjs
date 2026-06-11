// Cloudflare plugin: two entities (ZoneAccount, DnsRecord) + Cloudflare API sync.
// A local HTTP server stands in for the Cloudflare v4 API (PB_CLOUDFLARE_BASE_URL),
// so no real account/token is needed. Verifies:
//   - creating a ZoneAccount imports its existing A/CNAME records (MX filtered out)
//   - creating a DnsRecord suffixes the zone name, calls Cloudflare, stores record_id
//   - the opposite-`proxied` conflict is rejected
//   - updating a DnsRecord overwrites it on Cloudflare (PUT, merged state)
//   - deleting a DnsRecord deletes it on Cloudflare too
// Run: node --test test/cloudflare.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import cloudflarePlugin from '../dist/plugins/cloudflare/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.cloudflare.sqlite');
let db, server, base, cf, cfBase;
const cfCreated = []; // bodies POSTed to Cloudflare
const cfUpdated = []; // { id, body } PUT to Cloudflare
const cfDeleted = []; // record ids DELETEd on Cloudflare

const api = (m, p, b) =>
  fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// stand-in Cloudflare v4 API
function startCloudflare() {
  cf = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const path = req.url.split('?')[0];
      if (req.method === 'GET' && path.endsWith('/dns_records')) {
        return res.end(
          JSON.stringify({
            result_info: { total_pages: 1 },
            result: [
              {
                id: 'imp-a',
                name: 'a.example.com',
                type: 'A',
                content: '1.2.3.4',
                ttl: 120,
                proxied: false,
              },
              {
                id: 'imp-c',
                name: 'www.example.com',
                type: 'CNAME',
                content: 'example.com',
                ttl: 300,
                proxied: true,
              },
              {
                id: 'imp-m',
                name: 'mail.example.com',
                type: 'MX',
                content: 'mx.example.com',
                ttl: 3600,
                proxied: false,
              },
            ],
          }),
        );
      }
      if (req.method === 'POST' && path.endsWith('/dns_records')) {
        cfCreated.push(JSON.parse(raw || '{}'));
        return res.end(JSON.stringify({ result: { id: 'rec-new' } }));
      }
      if (req.method === 'PUT' && /\/dns_records\/[^/]+$/.test(path)) {
        cfUpdated.push({ id: path.split('/').pop(), body: JSON.parse(raw || '{}') });
        return res.end(JSON.stringify({ result: { id: path.split('/').pop() } }));
      }
      if (req.method === 'DELETE' && /\/dns_records\/[^/]+$/.test(path)) {
        cfDeleted.push(path.split('/').pop());
        return res.end(JSON.stringify({ success: true }));
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  return new Promise((r) => cf.listen(0, '127.0.0.1', () => r()));
}

before(async () => {
  await startCloudflare();
  cfBase = `http://127.0.0.1:${cf.address().port}`;
  process.env.PB_CLOUDFLARE_BASE_URL = cfBase;

  rmSync(DB, { force: true });
  db = new SqliteDb(DB);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [cloudflarePlugin]); // creates plugin tables + registers entities
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => cf.close(r));
  await db.close();
  rmSync(DB, { force: true });
  delete process.env.PB_CLOUDFLARE_BASE_URL;
});

let zoneId;

test('plugin registers both entities in the schema', async () => {
  const doc = await api('GET', '/api/schema/');
  const ids = JSON.stringify(doc.body.paths['/api/plugins/cloudflare/dns/accounts/']);
  assert.ok(ids.includes('plugin_cloudflare_zoneaccount_list'));
  assert.ok(doc.body.paths['/api/plugins/cloudflare/dns/records/']);
});

test('creating a ZoneAccount imports existing A/CNAME records (MX filtered out)', async () => {
  const z = await api('POST', '/api/plugins/cloudflare/dns/accounts/', {
    zone_name: 'example.com',
    zone_id: 'zone123',
    token: 'tok-secret',
  });
  assert.equal(z.status, 201, JSON.stringify(z.body));
  assert.equal(z.body.display, 'example.com'); // zone_name used as display
  zoneId = z.body.id;

  const list = await api('GET', '/api/plugins/cloudflare/dns/records/');
  assert.equal(list.status, 200);
  const names = list.body.results.map((r) => r.name).sort();
  assert.deepEqual(names, ['a.example.com', 'www.example.com']); // no MX
  const cname = list.body.results.find((r) => r.name === 'www.example.com');
  assert.equal(cname.record_id, 'imp-c');
  assert.equal(cname.type.value, 'CNAME'); // choice {value,label}
  assert.equal(cname.proxied, true);
  assert.equal(cname.zone.id, zoneId); // FK brief
});

test('creating a DnsRecord suffixes the zone, calls Cloudflare, stores record_id', async () => {
  const before = cfCreated.length;
  const r = await api('POST', '/api/plugins/cloudflare/dns/records/', {
    zone: zoneId,
    name: 'api',
    type: 'A',
    content: '9.9.9.9',
    ttl: 600,
    proxied: false,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.name, 'api.example.com'); // zone suffix appended
  assert.equal(r.body.record_id, 'rec-new'); // id returned by Cloudflare
  assert.equal(cfCreated.length, before + 1);
  assert.deepEqual(cfCreated.at(-1), {
    name: 'api.example.com',
    type: 'A',
    content: '9.9.9.9',
    ttl: 600,
    proxied: false,
  });
});

test('a name/type proxied conflict is rejected', async () => {
  const mk = (proxied) => ({ zone: zoneId, name: 'guard', type: 'A', content: '1.1.1.1', proxied });
  const a = await api('POST', '/api/plugins/cloudflare/dns/records/', mk(true));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await api('POST', '/api/plugins/cloudflare/dns/records/', mk(false));
  assert.equal(b.status, 400);
});

test('updating a DnsRecord syncs the change to Cloudflare', async () => {
  const created = await api('POST', '/api/plugins/cloudflare/dns/records/', {
    zone: zoneId,
    name: 'upd',
    type: 'A',
    content: '1.1.1.1',
    ttl: 3600,
  });
  const id = created.body.id;
  const before = cfUpdated.length;
  const r = await api('PATCH', `/api/plugins/cloudflare/dns/records/${id}/`, {
    content: '2.2.2.2',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.content, '2.2.2.2'); // local row updated
  assert.equal(cfUpdated.length, before + 1);
  const put = cfUpdated.at(-1);
  assert.equal(put.id, 'rec-new'); // the stored Cloudflare record id (PUT target)
  assert.deepEqual(put.body, {
    name: 'upd.example.com', // unchanged fields are merged, not dropped
    type: 'A',
    content: '2.2.2.2',
    ttl: 3600,
    proxied: false,
  });
});

test('deleting a DnsRecord deletes it on Cloudflare too', async () => {
  const created = await api('POST', '/api/plugins/cloudflare/dns/records/', {
    zone: zoneId,
    name: 'temp',
    type: 'A',
    content: '8.8.8.8',
  });
  const id = created.body.id;
  const before = cfDeleted.length;
  const del = await api('DELETE', `/api/plugins/cloudflare/dns/records/${id}/`);
  assert.equal(del.status, 204);
  assert.equal(cfDeleted.length, before + 1);
  assert.equal(cfDeleted.at(-1), 'rec-new'); // the stored record_id
  const gone = await api('GET', `/api/plugins/cloudflare/dns/records/${id}/`);
  assert.equal(gone.status, 404);
});
