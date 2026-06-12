// Built-in Docker plugin: end-to-end against the real engine. Mirrors
// test/plugins.test.mjs — apply the core SQLite schema, load the plugin (registers
// entities + applies its DDL), start the API server. Run: node --test test/docker.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteDb } from '../dist/db/sqlite.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { createApiServer } from '../dist/api/server.js';
import dockerPlugin from '../dist/plugins/docker/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB_FILE = join(ROOT, 'test', '.docker.sqlite');

let db, server, base, agent, agentLog;

const api = async (m, p, b) => {
  const res = await fetch(`${base}${p}`, {
    method: m,
    headers: b ? { 'Content-Type': 'application/json' } : undefined,
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : undefined };
};

before(async () => {
  // Stub Docker agent for the proxy actions.
  agentLog = [];
  agent = http.createServer((req, res) => {
    agentLog.push(`${req.method} ${req.url}`);
    if (req.url.endsWith('/logs')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello from container');
    } else if (req.url.endsWith('/exec')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stdout: 'ok' }));
    } else if (req.url.endsWith('/images')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pulled: true }));
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((r) => agent.listen(0, '127.0.0.1', r));
  globalThis.__AGENT__ = `http://127.0.0.1:${agent.address().port}`;

  rmSync(DB_FILE, { force: true });
  db = new SqliteDb(DB_FILE);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  await loadPlugins(db, [dockerPlugin]);
  server = createApiServer({ db });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.BASE_URL = base;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => agent.close(r));
  await db.close();
  rmSync(DB_FILE, { force: true });
});

// Shared ids populated across tests (ordered).
const ids = {};

test('plugin loads and registers its migration once', async () => {
  const rows = await db.query(
    "SELECT version FROM schema_migrations WHERE version LIKE 'plugin:docker:%'",
  );
  assert.deepEqual(
    rows.map((r) => r.version),
    ['plugin:docker:0001_initial', 'plugin:docker:0002_host_scope'],
  );
});

test('host create fires the default-registry hook; GET embeds nested arrays', async () => {
  const created = await api('POST', '/api/plugins/docker/hosts/', {
    endpoint: globalThis.__AGENT__,
    name: 'agent1',
  });
  assert.equal(created.status, 201);
  ids.host = created.body.id;
  // host state/operation are bare strings (agent-consumed), not {value,label}
  assert.equal(created.body.state, 'created');
  assert.equal(created.body.operation, 'none');

  const got = await api('GET', `/api/plugins/docker/hosts/${ids.host}/`);
  assert.equal(got.status, 200);
  assert.ok(got.body.url.endsWith(`/api/plugins/docker/hosts/${ids.host}/`));
  // hook created a "dockerhub" registry
  assert.equal(got.body.registries.length, 1);
  assert.equal(got.body.registries[0].name, 'dockerhub');
  ids.registry = got.body.registries[0].id;
  // reverse arrays present and empty
  for (const k of ['images', 'volumes', 'networks', 'containers'])
    assert.deepEqual(got.body[k], []);
});

test('create registry/image/volume/network under the host', async () => {
  const img = await api('POST', '/api/plugins/docker/images/', {
    host: ids.host,
    registry: ids.registry,
    name: 'nginx',
    version: 'latest',
  });
  assert.equal(img.status, 201, JSON.stringify(img.body));
  ids.image = img.body.id;

  const vol = await api('POST', '/api/plugins/docker/volumes/', { host: ids.host, name: 'data' });
  assert.equal(vol.status, 201, JSON.stringify(vol.body));
  assert.equal(vol.body.driver, 'local'); // bare string, not a {value,label} choice
  ids.volume = vol.body.id;

  const net = await api('POST', '/api/plugins/docker/networks/', {
    host: ids.host,
    name: 'frontend',
  });
  assert.equal(net.status, 201, JSON.stringify(net.body));
  assert.equal(net.body.state, 'creating'); // bare string, not a {value,label} choice
  ids.network = net.body.id;

  // image GET embeds host/registry briefs + (empty) containers array
  const imgGet = await api('GET', `/api/plugins/docker/images/${ids.image}/`);
  assert.equal(imgGet.body.host.name, 'agent1');
  assert.equal(imgGet.body.registry.name, 'dockerhub');
  assert.deepEqual(imgGet.body.containers, []);
});

test('container POST accepts inline nested children and echoes them', async () => {
  const body = {
    host: ids.host,
    image: ids.image,
    name: 'web',
    ports: [{ private_port: 80, public_port: 8080, type: 'tcp' }],
    env: [{ var_name: 'DEBUG', value: '1' }],
    labels: [{ key: 'role', value: 'web' }],
    log_driver_options: [{ option_name: 'max-size', value: '10m' }],
    mounts: [{ source: '/srv', volume: ids.volume, read_only: true }],
    binds: [{ host_path: '/h', container_path: '/c', read_only: false }],
    network_settings: [{ network: ids.network }],
    devices: [{ host_path: '/dev/a', container_path: '/dev/b' }],
    sysctls: [{ key: 'net.core.somaxconn', value: '1024' }],
    cap_add: ['NET_ADMIN'],
    cmd: ['nginx', '-g', 'daemon off;'],
  };
  const res = await api('POST', '/api/plugins/docker/containers/', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  ids.container = res.body.id;
  assert.equal(res.body.ports.length, 1);
  assert.deepEqual(res.body.ports[0], { public_port: 8080, private_port: 80, type: 'tcp' });
  assert.deepEqual(res.body.env[0], { var_name: 'DEBUG', value: '1' });
  assert.equal(res.body.mounts[0].source, '/srv');
  assert.equal(res.body.mounts[0].read_only, true);
  assert.equal(res.body.mounts[0].volume.name, 'data'); // nested brief
  assert.equal(res.body.network_settings[0].network.name, 'frontend');
  assert.deepEqual(res.body.cap_add, ['NET_ADMIN']);
  assert.deepEqual(res.body.cmd, ['nginx', '-g', 'daemon off;']);
  // agent-consumed choices are bare strings, not {value,label}
  assert.equal(res.body.operation, 'create');
  assert.equal(res.body.state, 'none');
  assert.equal(res.body.restart_policy, 'no');
  // FK briefs use the source field sets
  assert.equal(res.body.host.endpoint, globalThis.__AGENT__);
  assert.equal(res.body.image.version, 'latest');

  // GET detail matches the POST shape
  const got = await api('GET', `/api/plugins/docker/containers/${ids.container}/`);
  assert.equal(got.body.ports.length, 1);
  assert.equal(got.body.sysctls[0].key, 'net.core.somaxconn');
  assert.equal(got.body.devices[0].host_path, '/dev/a');
});

test('container PATCH replaces only the provided child arrays', async () => {
  const res = await api('PATCH', `/api/plugins/docker/containers/${ids.container}/`, {
    ports: [
      { private_port: 443, public_port: 8443, type: 'tcp' },
      { private_port: 53, public_port: 5353, type: 'udp' },
    ],
    ContainerID: 'abc123',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ports.length, 2);
  assert.equal(res.body.ContainerID, 'abc123');
  // env was not in the PATCH body → left untouched
  assert.equal(res.body.env.length, 1);
});

test('host GET now lists the container under its nested arrays', async () => {
  const got = await api('GET', `/api/plugins/docker/hosts/${ids.host}/`);
  assert.equal(got.body.containers.length, 1);
  assert.equal(got.body.containers[0].name, 'web');
  assert.equal(got.body.images.length, 1);
});

test('cross-host container is rejected with a NetBox field error', async () => {
  const h2 = await api('POST', '/api/plugins/docker/hosts/', {
    endpoint: 'http://other',
    name: 'agent2',
  });
  const reg2 = (await api('GET', `/api/plugins/docker/hosts/${h2.body.id}/`)).body.registries[0].id;
  const img2 = await api('POST', '/api/plugins/docker/images/', {
    host: h2.body.id,
    registry: reg2,
    name: 'redis',
  });
  const res = await api('POST', '/api/plugins/docker/containers/', {
    host: ids.host,
    image: img2.body.id, // image belongs to agent2, container on agent1
    name: 'bad',
  });
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.image));
  assert.match(res.body.image[0], /does not belong to host/);
});

test('container validation reuses the engine (missing required field)', async () => {
  const res = await api('POST', '/api/plugins/docker/containers/', { host: ids.host });
  assert.equal(res.status, 400);
  // image + name are required
  assert.ok(res.body.image || res.body.name);
});

test('list pagination + filtering', async () => {
  const page = await api('GET', '/api/plugins/docker/containers/?limit=1');
  assert.equal(page.body.count >= 1, true);
  assert.equal(page.body.results.length, 1);
  const filtered = await api('GET', '/api/plugins/docker/containers/?name=web');
  assert.equal(filtered.body.count, 1);
  assert.equal(filtered.body.results[0].name, 'web');
});

test('FK filter: registries filterable by host_id (NetBox `<fk>_id` alias)', async () => {
  // Two hosts, each auto-gets a "dockerhub" registry via the create hook.
  const hostA = (
    await api('POST', '/api/plugins/docker/hosts/', { endpoint: 'http://a', name: 'fa' })
  ).body.id;
  const hostB = (
    await api('POST', '/api/plugins/docker/hosts/', { endpoint: 'http://b', name: 'fb' })
  ).body.id;
  // give host A a second registry, so the two hosts have different counts (2 vs 1)
  const extra = await api('POST', '/api/plugins/docker/registries/', {
    host: hostA,
    name: 'extra',
    serveraddress: 'reg.a',
  });
  assert.equal(extra.status, 201, JSON.stringify(extra.body));

  // host_id returns exactly that host's registries — and nothing from the other host
  const a = await api('GET', `/api/plugins/docker/registries/?host_id=${hostA}`);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.count, 2);
  assert.ok(a.body.results.every((r) => r.host.id === hostA));

  const b = await api('GET', `/api/plugins/docker/registries/?host_id=${hostB}`);
  assert.equal(b.body.count, 1);
  assert.ok(b.body.results.every((r) => r.host.id === hostB));

  // the relation-name form resolves to the same rows
  const byName = await api('GET', `/api/plugins/docker/registries/?host=${hostA}`);
  assert.equal(byName.body.count, a.body.count);

  // lookups ride the alias: __in unions both hosts, __n excludes one
  const inBoth = await api('GET', `/api/plugins/docker/registries/?host_id__in=${hostA},${hostB}`);
  assert.equal(inBoth.body.count, 3);
  const notA = await api('GET', `/api/plugins/docker/registries/?host_id__n=${hostA}`);
  assert.ok(notA.body.results.every((r) => r.host.id !== hostA));

  // an unknown field is still rejected with a 400
  const bad = await api('GET', '/api/plugins/docker/registries/?bogus_id=1');
  assert.equal(bad.status, 400);
  assert.match(bad.body.detail, /Unknown filter field "bogus_id"/);
});

test('FK write: `host` accepts a numeric string (single + bulk POST)', async () => {
  // single create with host as a string id
  const single = await api('POST', '/api/plugins/docker/registries/', {
    host: String(ids.host),
    name: 'str-single',
    serveraddress: 'https://reg.single/v2/',
  });
  assert.equal(single.status, 201, JSON.stringify(single.body));
  assert.equal(single.body.host.id, ids.host);

  // bulk create — the reported payload shape (array, host as "14")
  const bulk = await api('POST', '/api/plugins/docker/registries/', [
    { host: String(ids.host), name: 'str-a', serveraddress: 'https://reg.a/v2/' },
    { host: String(ids.host), name: 'str-b', serveraddress: 'https://reg.b/v2/' },
  ]);
  assert.equal(bulk.status, 201, JSON.stringify(bulk.body));
  assert.equal(bulk.body.length, 2);
  assert.ok(bulk.body.every((r) => r.host.id === ids.host));

  // a non-numeric string is still rejected with the NetBox field error
  const bad = await api('POST', '/api/plugins/docker/registries/', {
    host: 'not-a-number',
    name: 'nope',
    serveraddress: 'https://reg.x/v2/',
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.host, ['A valid number is required.']);
});

test('Container pid_mode accepts "" (blank choice → null)', async () => {
  const c = await api('POST', '/api/plugins/docker/containers/', {
    host: ids.host,
    image: ids.image,
    name: 'blank-pid',
    pid_mode: '',
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.pid_mode, null); // unset choice serializes as null
  // the one real choice still works, and a bogus value is still rejected
  const bad = await api('POST', '/api/plugins/docker/containers/', {
    host: ids.host,
    image: ids.image,
    name: 'bad-pid',
    pid_mode: 'container',
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.pid_mode);
});

test('container POST resolves agent natural keys (image ImageID, network name)', async () => {
  const SHA = 'sha256:deadbeefcafe0000';
  const img = await api('POST', '/api/plugins/docker/images/', {
    host: ids.host,
    registry: ids.registry,
    name: 'by-sha',
    ImageID: SHA,
  });
  assert.equal(img.status, 201, JSON.stringify(img.body));

  // image given by ImageID, network by name, ports as numeric strings
  const res = await api('POST', '/api/plugins/docker/containers/', {
    host: String(ids.host),
    name: 'agent-shaped',
    image: { host: String(ids.host), ImageID: SHA },
    pid_mode: '',
    network_settings: [{ network: { host: String(ids.host), name: 'frontend' } }],
    ports: [{ public_port: '1882', private_port: '1880', type: 'tcp' }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.image.id, img.body.id); // resolved by ImageID
  assert.equal(res.body.network_settings[0].network.name, 'frontend'); // resolved by name
  assert.deepEqual(res.body.ports[0], { public_port: 1882, private_port: 1880, type: 'tcp' });

  // an unknown ImageID is a clear 400, not a null-FK error
  const bad = await api('POST', '/api/plugins/docker/containers/', {
    host: ids.host,
    name: 'bad-sha',
    image: { ImageID: 'sha256:doesnotexist' },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.image[0], /No image with ImageID/);
});

test('Network driver accepts "none"', async () => {
  const net = await api('POST', '/api/plugins/docker/networks/', {
    host: ids.host,
    name: 'none-net',
    driver: 'none',
  });
  assert.equal(net.status, 201, JSON.stringify(net.body));
  assert.deepEqual(net.body.driver, { value: 'none', label: 'None' });

  // the Docker agent sends Docker-cased values — "None"/"Bridge" map to the
  // canonical lowercase choice rather than failing the choice check
  for (const [sent, value] of [
    ['None', 'none'],
    ['Bridge', 'bridge'],
  ]) {
    const r = await api('POST', '/api/plugins/docker/networks/', {
      host: ids.host,
      name: `cased-${sent}`,
      driver: sent,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.driver.value, value);
  }

  // a genuinely unsupported driver is still rejected
  const bad = await api('POST', '/api/plugins/docker/networks/', {
    host: ids.host,
    name: 'bad-net',
    driver: 'overlay',
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.driver);
});

test('FK write: FK accepts a nested brief object ({ id })', async () => {
  // the reported image payload — registry given as { id }, host as a string
  const img = await api('POST', '/api/plugins/docker/images/', {
    host: String(ids.host),
    name: 'registry.example/c4/postgres',
    registry: { id: ids.registry },
    version: '0.0.2',
    size: 457,
  });
  assert.equal(img.status, 201, JSON.stringify(img.body));
  assert.equal(img.body.host.id, ids.host);
  assert.equal(img.body.registry.id, ids.registry);

  // an object without a usable id still fails (registry is required + non-null)
  const bad = await api('POST', '/api/plugins/docker/images/', {
    host: ids.host,
    name: 'no-reg',
    registry: {},
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.registry);
});

test('agent proxy actions: force_pull / logs / exec', async () => {
  const pull = await api('POST', `/api/plugins/docker/images/${ids.image}/force_pull/`);
  assert.equal(pull.status, 200, JSON.stringify(pull.body));
  assert.deepEqual(pull.body, { success: true, payload: { pulled: true } });

  const logs = await api('GET', `/api/plugins/docker/containers/${ids.container}/logs/`);
  assert.equal(logs.status, 200);
  assert.equal(logs.body, 'hello from container');

  const exec = await api('POST', `/api/plugins/docker/containers/${ids.container}/exec/`, {
    cmd: ['ls', '-la'],
  });
  assert.equal(exec.status, 200);
  assert.deepEqual(exec.body, { stdout: 'ok' });

  assert.ok(agentLog.some((l) => l.includes('/api/engine/containers/abc123/logs')));
});

test('exec rejects a non-list cmd', async () => {
  const res = await api('POST', `/api/plugins/docker/containers/${ids.container}/exec/`, {
    cmd: 'not-a-list',
  });
  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.cmd));
});

test('core API still works alongside the plugin', async () => {
  const m = await api('POST', '/api/dcim/manufacturers/', { name: 'Acme', slug: 'acme' });
  assert.equal(m.status, 201);
});

test('docker resources appear in the OpenAPI schema', async () => {
  const schema = await api('GET', '/api/schema/');
  assert.ok(schema.body.paths['/api/plugins/docker/hosts/']);
  assert.ok(schema.body.paths['/api/plugins/docker/containers/']);
});

test('host operation=refresh marks state refreshing and purges resources', async () => {
  // self-contained host with a full set of resources
  const h = (await api('POST', '/api/plugins/docker/hosts/', { endpoint: 'http://r', name: 'rh' }))
    .body;
  const reg = (await api('GET', `/api/plugins/docker/hosts/${h.id}/`)).body.registries[0].id;
  const img = (
    await api('POST', '/api/plugins/docker/images/', { host: h.id, registry: reg, name: 'nginx' })
  ).body;
  const vol = (await api('POST', '/api/plugins/docker/volumes/', { host: h.id, name: 'data' }))
    .body;
  const net = (await api('POST', '/api/plugins/docker/networks/', { host: h.id, name: 'fe' })).body;
  await api('POST', '/api/plugins/docker/containers/', {
    host: h.id,
    image: img.id,
    name: 'c1',
    ports: [{ private_port: 80, public_port: 8080, type: 'tcp' }],
    mounts: [{ source: '/s', volume: vol.id }], // RESTRICT ref to the volume
    network_settings: [{ network: net.id }], // RESTRICT ref to the network
  });
  const counts = async () =>
    (
      await Promise.all(
        ['images', 'volumes', 'networks', 'containers'].map((r) =>
          api('GET', `/api/plugins/docker/${r}/?host_id=${h.id}`).then((x) => x.body.count),
        ),
      )
    ).join(',');
  assert.equal(await counts(), '1,1,1,1');

  const upd = await api('PATCH', `/api/plugins/docker/hosts/${h.id}/`, { operation: 'refresh' });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.state, 'refreshing'); // set before storing
  assert.equal(upd.body.operation, 'refresh');
  assert.equal(await counts(), '0,0,0,0'); // all discovered resources purged
  // registries survive a refresh
  assert.equal((await api('GET', `/api/plugins/docker/registries/?host_id=${h.id}`)).body.count, 1);

  // a normal update doesn't purge
  await api('POST', '/api/plugins/docker/images/', { host: h.id, registry: reg, name: 'redis' });
  const ren = await api('PATCH', `/api/plugins/docker/hosts/${h.id}/`, { name: 'rh2' });
  assert.equal(ren.body.name, 'rh2');
  assert.equal((await api('GET', `/api/plugins/docker/images/?host_id=${h.id}`)).body.count, 1);
});
