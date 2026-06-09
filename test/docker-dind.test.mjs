// REAL Docker-in-Docker integration. Boots a `docker:dind` daemon and a stub agent
// that DRIVES THAT REAL DOCKERD. Two paths are exercised:
//   1. event-driven:  paasbox --(webhook: container created)--> agent --(docker run)--> dind
//                            <--(callback: PATCH ContainerID)-- agent
//   2. proxy actions: paasbox --(POST .../exec, GET .../logs, POST .../force_pull)-->
//                     agent's /api/engine/* --(docker exec|logs|pull)--> dind
// and asserts REAL effects inside dind (a running container, its real stdout/logs, a pulled image).
//
// Gated behind PB_DIND=1 + a working `docker` CLI. Run:
//   npm run build && PB_DIND=1 PB_WEBHOOK_BACKOFF_MS=50 node --test --test-timeout=300000 test/docker-dind.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDb } from '../dist/db/sqlite.js';
import { createApiServer } from '../dist/api/server.js';
import { loadPlugins } from '../dist/plugins/runtime.js';
import dockerPlugin from '../dist/plugins/docker/index.js';

const exec = promisify(execFile);
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DB = join(ROOT, 'test', '.docker-dind.sqlite');
const DIND = 'pbx-dind-test';
const IMG = 'busybox:1.36'; // small; pulled inside dind
const PULL_IMG = 'hello-world'; // pulled on-demand by force_pull
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENABLED = process.env.PB_DIND === '1';
/** run a docker command INSIDE the dind daemon (i.e. drive the real engine) */
const dind = (...args) => exec('docker', ['exec', DIND, 'docker', ...args], { timeout: 120000 });

let db, server, base, paasboxBase, agent, agentBase, hostId, imageId, ready, webContainerId;

if (!ENABLED) {
  test('dind integration (set PB_DIND=1 to run)', { skip: 'PB_DIND not set' }, () => {});
} else {
  before(async () => {
    // 1) boot a real dockerd inside a container
    await exec('docker', ['rm', '-f', DIND]).catch(() => {});
    await exec('docker', [
      'run',
      '-d',
      '--privileged',
      '--name',
      DIND,
      '-e',
      'DOCKER_TLS_CERTDIR=',
      'docker:dind',
    ]);
    for (let i = 0; i < 60; i++) {
      try {
        await dind('info');
        ready = true;
        break;
      } catch {
        await sleep(1000);
      }
    }
    if (!ready) throw new Error('dind dockerd did not become ready');
    await dind('pull', IMG);

    // 2) stub agent that DRIVES the real dind dockerd
    const cidLogs = /^\/api\/engine\/containers\/([^/]+)\/logs$/;
    const cidExec = /^\/api\/engine\/containers\/([^/]+)\/exec$/;
    agent = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        void (async () => {
          const body = raw ? JSON.parse(raw) : {};
          try {
            // event feed: provision the container for real, then report back
            if (req.url === '/webhook') {
              console.log('  [agent] <- webhook call fired by paasbox; payload:');
              console.log('    ' + JSON.stringify(body));
              if (body.model === 'plugins.dockercontainer' && body.event === 'created') {
                const cid = `pbx_${body.object_id}`;
                await dind(
                  'run',
                  '-d',
                  '--name',
                  cid,
                  IMG,
                  'sh',
                  '-c',
                  `echo READY-${body.data?.name}; sleep 300`,
                );
                await fetch(`${paasboxBase}/api/plugins/docker/containers/${body.object_id}/`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ContainerID: cid }),
                });
              }
              console.log('  [agent] -> returning 200 to paasbox');
              res.writeHead(200);
              return res.end('ok');
            }
            // proxy action: force_pull -> docker pull
            if (req.url === '/api/engine/images') {
              await dind('pull', body.data?.name ?? IMG);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ pulled: true, image: body.data?.name }));
            }
            // proxy action: logs -> docker logs
            const ml = cidLogs.exec(req.url);
            if (ml && req.method === 'GET') {
              const { stdout } = await dind('logs', ml[1]);
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              return res.end(stdout);
            }
            // proxy action: exec -> docker exec
            const me = cidExec.exec(req.url);
            if (me && (req.method === 'PUT' || req.method === 'POST')) {
              const { stdout } = await dind('exec', me[1], ...(body.cmd ?? []));
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ stdout }));
            }
            res.writeHead(404);
            res.end('nope');
          } catch (e) {
            res.writeHead(502);
            res.end(String(e?.stderr || e?.message || e));
          }
        })();
      });
    });
    await new Promise((r) => agent.listen(0, '127.0.0.1', () => r()));
    agentBase = `http://127.0.0.1:${agent.address().port}`;

    // 3) paasbox
    rmSync(DB, { force: true });
    db = new SqliteDb(DB);
    db.exec(readFileSync(join(ROOT, 'datamodel', 'sql', 'schema.sqlite.sql'), 'utf8'));
    db.exec(readFileSync(join(ROOT, 'migrations', '0003_webhook.sqlite.sql'), 'utf8'));
    db.exec(
      readFileSync(join(ROOT, 'migrations', '0004_webhook_conditions_delivery.sqlite.sql'), 'utf8'),
    );
    await loadPlugins(db, [dockerPlugin]);
    server = createApiServer({ db });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    paasboxBase = base;

    const wh = await pb('POST', '/api/extras/webhooks/', {
      name: 'docker-agent',
      payload_url: `${agentBase}/webhook`,
      object_types: ['plugins.dockercontainer'],
      events: ['created'],
    });
    console.log('  [dind-test] webhook configuration inserted:');
    console.log(
      '    ' +
        JSON.stringify({
          name: wh.name,
          payload_url: wh.payload_url,
          http_method: wh.http_method,
          object_types: wh.object_types,
          events: wh.events,
          enabled: wh.enabled,
        }),
    );
    hostId = (
      await pb('POST', '/api/plugins/docker/hosts/', { endpoint: agentBase, name: 'dind-host' })
    ).id;
    const reg = (
      await pb('POST', '/api/plugins/docker/registries/', {
        host: hostId,
        name: 'r',
        serveraddress: 'https://r/v2/',
      })
    ).id;
    imageId = (
      await pb('POST', '/api/plugins/docker/images/', { host: hostId, registry: reg, name: IMG })
    ).id;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (agent) await new Promise((r) => agent.close(r));
    if (db) await db.close();
    rmSync(DB, { force: true });
    await exec('docker', ['rm', '-f', DIND]).catch(() => {});
  });

  const pb = (m, p, b) =>
    fetch(`${base}${p}`, {
      method: m,
      headers: b ? { 'Content-Type': 'application/json' } : undefined,
      body: b ? JSON.stringify(b) : undefined,
    }).then((r) => r.json());

  test('event: creating a container runs a REAL container in dind', async () => {
    const r = await pb('POST', '/api/plugins/docker/containers/', {
      host: hostId,
      image: imageId,
      name: 'web',
    });
    webContainerId = r.id;
    const cid = `pbx_${r.id}`;
    let containerId = null;
    for (let i = 0; i < 120; i++) {
      const got = await pb('GET', `/api/plugins/docker/containers/${r.id}/`);
      if (got.ContainerID) {
        containerId = got.ContainerID;
        break;
      }
      await sleep(250);
    }
    assert.equal(containerId, cid, 'agent never reported ContainerID');
    const { stdout } = await dind('ps', '--filter', `name=${cid}`, '--format', '{{.Names}}');
    assert.match(stdout, new RegExp(cid), `container not running in dind:\n${stdout}`);

    // what paasbox recorded for the webhook delivery (the agent's return code)
    const deliveries = await pb('GET', '/api/extras/webhook-deliveries/?ordering=-id&limit=1');
    const last = deliveries.results?.[0];
    console.log('  [dind-test] docker agent returned (from paasbox delivery log):');
    console.log(
      '    ' +
        JSON.stringify({
          model: last?.object_type,
          event: last?.event,
          status_code: last?.status_code,
          success: last?.success,
          attempts: last?.attempts,
        }),
    );
  });

  test('proxy: exec runs a command in the REAL container via the agent -> dockerd', async () => {
    const res = await pb('POST', `/api/plugins/docker/containers/${webContainerId}/exec/`, {
      cmd: ['echo', 'hello-from-dockerd'],
    });
    assert.match(String(res.stdout), /hello-from-dockerd/, JSON.stringify(res));
  });

  test('proxy: logs returns the REAL container stdout via the agent -> dockerd', async () => {
    const res = await fetch(`${base}/api/plugins/docker/containers/${webContainerId}/logs/`).then(
      (r) => r.json(),
    );
    assert.match(String(res), /READY-web/, JSON.stringify(res));
  });

  test('proxy: force_pull pulls a NEW image into dind via the agent -> dockerd', async () => {
    const img2 = (
      await pb('POST', '/api/plugins/docker/images/', {
        host: hostId,
        registry:
          (await pb('GET', `/api/plugins/docker/hosts/${hostId}/`)).registries?.[0]?.id ?? null,
        name: PULL_IMG,
      })
    ).id;
    // ensure it's absent first
    await dind('rmi', '-f', PULL_IMG).catch(() => {});
    const pull = await pb('POST', `/api/plugins/docker/images/${img2}/force_pull/`);
    assert.equal(pull.success, true, JSON.stringify(pull));
    const { stdout } = await dind('images', '--format', '{{.Repository}}');
    assert.match(stdout, new RegExp(PULL_IMG), `image not pulled into dind:\n${stdout}`);
  });
}
