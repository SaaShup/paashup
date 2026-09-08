// The container terminal WebSocket relay:
//   browser  --(ws /api/plugins/docker/containers/:id/ws/)-->  paasbox
//            <--(pipes frames)-->  paasbox  --(POST/WS /api/engine/containers/:cid/ws)--> agent
// The stub agent below stands in for SaaShup/netbox-docker-agent's docker-exec-websocket
// stream: POST returns {path}, then a WS at that path speaks the msgcode-prefixed frame
// protocol (0 stdin, 1 stdout, 2 stderr, 50 resize, 100 resume, 200 exited, …).
// Run: node --test test/docker-terminal.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import { createToken } from '../dist/auth.js';
import dockerPlugin from '../dist/plugins/docker/index.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.docker-terminal.sqlite');
const MIGRATIONS = ['0003_webhook', '0004_webhook_conditions_delivery', '0010_webhook_template'];

const basicAuth = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

async function freshDb(file) {
  rmSync(file, { force: true });
  const db = new SqliteDb(file);
  db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
  for (const m of MIGRATIONS)
    db.exec(readFileSync(join(ROOT, 'migrations', `${m}.sqlite.sql`), 'utf8'));
  await loadPlugins(db, [dockerPlugin]);
  return db;
}

// ---- stub agent: docker-exec-websocket-server stand-in --------------------------------
// `POST …/ws` opens a session (or refuses it); the WS it points at then exchanges frames.
// `seen` records what paasbox sent it, for the auth/forwarding assertions.
function startStubAgent() {
  const seen = { postAuth: [], wsAuth: null, wsQuery: null, resize: null, stdin: [] };
  let disabled = false;
  const http_ = http.createServer((req, res) => {
    seen.postAuth.push(req.headers.authorization ?? null);
    const m = /^\/api\/engine\/containers\/([^/]+)\/ws$/.exec(req.url);
    if (m && req.method === 'POST') {
      if (disabled) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ code: 403, message: 'Exec stream is disabled' }));
      }
      if (m[1] !== 'cid-1') {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ code: 404, message: 'Containers not found' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ path: `/ws/engine/containers/${m[1]}/exec` }));
    }
    res.writeHead(404);
    res.end('nope');
  });
  const streamWss = new WebSocketServer({ noServer: true });
  http_.on('upgrade', (req, socket, head) => {
    seen.wsAuth = req.headers.authorization ?? null;
    seen.wsQuery = new URL(req.url, 'http://x').search;
    streamWss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(Buffer.from([100])); // resume: the shell is ready for input
      ws.send(Buffer.concat([Buffer.from([1]), Buffer.from('hello$ ')])); // stdout greeting
      ws.on('message', (data) => {
        const b = Buffer.from(data);
        if (b[0] === 0) {
          const line = b.subarray(1).toString();
          seen.stdin.push(line);
          if (line === 'exit\r')
            ws.send(Buffer.from([200, 7])); // exited, code 7
          else ws.send(Buffer.concat([Buffer.from([1]), b.subarray(1)])); // echo as stdout
        } else if (b[0] === 50) {
          seen.resize = [b.readUInt16LE(1), b.readUInt16LE(3)];
        }
      });
    });
  });
  return {
    server: http_,
    seen,
    setDisabled: (v) => (disabled = v),
    listen: () => new Promise((r) => http_.listen(0, '127.0.0.1', r)),
    close: () => new Promise((r) => http_.close(r)),
  };
}

/** Drive one client session against paasbox's relay; resolves on close. */
function session(base, id, query = '?tty=true&command=bash', driveShell = true) {
  return new Promise((resolve) => {
    const wsBase = base.replace('http', 'ws');
    const ws = new WebSocket(`${wsBase}/api/plugins/docker/containers/${id}/ws/${query}`);
    ws.binaryType = 'nodebuffer';
    const out = [];
    let exit = null;
    ws.on('message', (data) => {
      const b = Buffer.from(data);
      if (b[0] === 1 || b[0] === 2) out.push(b.subarray(1).toString());
      if (b[0] === 100 && driveShell) {
        ws.send(Buffer.from([50, 24, 0, 80, 0])); // resize: 24 rows, 80 cols
        ws.send(Buffer.concat([Buffer.from([0]), Buffer.from('ls\r')]));
        setTimeout(() => ws.send(Buffer.concat([Buffer.from([0]), Buffer.from('exit\r')])), 30);
      }
      if (b[0] === 200) {
        exit = b[1];
        ws.close(1000, 'bye');
      }
    });
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString(), out, exit }));
    ws.on('error', (err) => resolve({ error: err.message }));
    setTimeout(() => {
      if (ws.readyState <= WebSocket.OPEN) ws.terminate();
    }, 4000);
  });
}

let db, server, base, agent, agentUrl, hostId, c1, c2, c3;

before(async () => {
  db = await freshDb(DB);
  server = createApiServer({ db, realtime: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  agent = startStubAgent();
  await agent.listen();
  // credentials embedded in the host endpoint — must survive as Basic auth (see splitCredentials)
  agentUrl = `http://admin:saashup@127.0.0.1:${agent.server.address().port}`;

  const pb = (m, p, b) =>
    fetch(base + p, {
      method: m,
      headers: b ? { 'content-type': 'application/json' } : undefined,
      body: b ? JSON.stringify(b) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  hostId = (await pb('POST', '/api/plugins/docker/hosts/', { endpoint: agentUrl, name: 'h' })).body
    .id;
  const registryId = (
    await pb('POST', '/api/plugins/docker/registries/', {
      host: hostId,
      name: 'reg',
      serveraddress: 'https://r/v2/',
    })
  ).body.id;
  const imageId = (
    await pb('POST', '/api/plugins/docker/images/', {
      host: hostId,
      registry: registryId,
      name: 'nginx',
    })
  ).body.id;
  c1 = (
    await pb('POST', '/api/plugins/docker/containers/', {
      host: hostId,
      image: imageId,
      name: 'running',
      ContainerID: 'cid-1', // known to the stub agent
    })
  ).body.id;
  c2 = (
    await pb('POST', '/api/plugins/docker/containers/', {
      host: hostId,
      image: imageId,
      name: 'gone',
      ContainerID: 'cid-2', // has an id, but unknown to the agent
    })
  ).body.id;
  c3 = (
    await pb('POST', '/api/plugins/docker/containers/', {
      host: hostId,
      image: imageId,
      name: 'pending',
    })
  ).body.id; // no ContainerID yet
});

after(async () => {
  await new Promise((r) => server.close(r));
  await agent.close();
  await db.close();
  rmSync(DB, { force: true });
});

test('relays frames both ways, forwards resize + query, and uses Basic auth from the host endpoint', async () => {
  const r = await session(base, c1);
  assert.equal(r.exit, 7, JSON.stringify(r));
  assert.equal(r.code, 1000);
  assert.ok(r.out.join('').includes('hello$ '), 'did not see the agent stdout greeting');
  assert.ok(r.out.join('').includes('ls\r'), 'did not see the echoed stdin');
  assert.deepEqual(agent.seen.resize, [24, 80]);
  assert.deepEqual(agent.seen.stdin, ['ls\r', 'exit\r']);
  assert.equal(agent.seen.postAuth.at(-1), basicAuth('admin', 'saashup'));
  assert.equal(agent.seen.wsAuth, basicAuth('admin', 'saashup'));
  assert.equal(agent.seen.wsQuery, '?tty=true&command=bash');
});

test('a container the agent no longer knows about closes with 4004 and the agent message', async () => {
  const r = await session(base, c2, '?tty=true&command=sh', false);
  assert.equal(r.code, 4004);
  assert.equal(r.reason, 'Containers not found');
});

test('a container without a ContainerID yet is refused without ever calling the agent', async () => {
  const before = agent.seen.postAuth.length;
  const r = await session(base, c3, '?tty=true&command=sh', false);
  assert.equal(r.code, 4004);
  assert.match(r.reason, /not created on its host/i);
  assert.equal(agent.seen.postAuth.length, before, 'the agent should not have been contacted');
});

test('an unknown paasbox container id closes with 4004', async () => {
  const r = await session(base, 999999, '?tty=true&command=sh', false);
  assert.equal(r.code, 4004);
  assert.match(r.reason, /not found/i);
});

test('the agent refusing the exec stream (DISABLE_EXEC) surfaces as 4003', async () => {
  agent.setDisabled(true);
  try {
    const r = await session(base, c1, '?tty=true&command=sh', false);
    assert.equal(r.code, 4003);
    assert.equal(r.reason, 'Exec stream is disabled');
  } finally {
    agent.setDisabled(false);
  }
});

test('an unmatched WebSocket path gets a plain HTTP 404, not silently dropped', async () => {
  const wsBase = base.replace('http', 'ws');
  const message = await new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/api/plugins/docker/containers/1/nope/`);
    ws.on('error', (err) => resolve(err.message));
    ws.on('open', () => resolve('unexpectedly opened'));
  });
  assert.match(message, /404/);
});

test('the realtime change-feed keeps working on the same server (shared upgrade router)', async () => {
  const wsBase = base.replace('http', 'ws');
  const type = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/api/ws/`);
    const t = setTimeout(() => reject(new Error('no hello from the change-feed')), 3000);
    ws.on('message', (data) => {
      clearTimeout(t);
      resolve(JSON.parse(data.toString()).type);
      ws.close();
    });
    ws.on('error', reject);
  });
  assert.equal(type, 'hello');
});

test('when the server requires auth, an anonymous terminal connection is rejected and a token is accepted', async () => {
  const F = join(ROOT, 'test', '.docker-terminal-auth.sqlite');
  const adb = await freshDb(F);
  adb.exec(readFileSync(join(ROOT, 'migrations', '0002_auth_token.sqlite.sql'), 'utf8'));
  const u = await adb.execute('INSERT INTO users_user (username) VALUES (?)', ['svc']);
  const { key } = await createToken(adb, { userId: u.insertId, writeEnabled: true });
  const asrv = createApiServer({ db: adb, auth: { required: true } });
  await new Promise((r) => asrv.listen(0, '127.0.0.1', r));
  const abase = `http://127.0.0.1:${asrv.address().port}`;
  const awsBase = abase.replace('http', 'ws');

  try {
    // anonymous: rejected before paasbox even looks at the container. This is a plain
    // HTTP-level refusal (no WS handshake completes), so the client sees an error, not
    // a close code — like the "unmatched path" 404 case above.
    const anonMessage = await new Promise((resolve) => {
      const ws = new WebSocket(
        `${awsBase}/api/plugins/docker/containers/${c1}/ws/?tty=true&command=sh`,
      );
      ws.on('error', (err) => resolve(err.message));
      ws.on('open', () => resolve('unexpectedly opened'));
    });
    assert.match(anonMessage, /401/);

    // token in the query string (browsers can't set headers on `new WebSocket(...)`)
    const withToken = await session(abase, 999999, `?tty=true&command=sh&token=${key}`, false);
    // reaches the plugin route (proven by the *docker* 404, not the auth 401)
    assert.equal(withToken.code, 4004);
  } finally {
    await new Promise((r) => asrv.close(r));
    await adb.close();
    rmSync(F, { force: true });
  }
});
