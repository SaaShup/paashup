// REAL Docker-in-Docker integration. Boots a `docker:dind` daemon, then drives the
// full chain with a real engine:
//   paasbox --(webhook: container created)--> agent --(docker run)--> dind dockerd
//          <--(callback: PATCH ContainerID)-- agent
// and asserts a REAL container is actually running inside dind.
//
// Gated: only runs with PB_DIND=1 and a working `docker` CLI (so the normal suite
// stays fast and Docker-free). Run:
//   npm run build && PB_DIND=1 PB_WEBHOOK_BACKOFF_MS=50 node --test test/docker-dind.test.mjs
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
const IMG = 'busybox:1.36'; // small, pulled inside dind
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENABLED = process.env.PB_DIND === '1';
const dind = (...args) => exec('docker', ['exec', DIND, 'docker', ...args], { timeout: 120000 });

let db, server, base, paasboxBase, agent, agentBase, hostId, imageId, ready;

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
    // wait for the inner daemon
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
    await dind('pull', IMG); // pre-pull the test image

    // 2) minimal agent: on a container-created webhook, `docker run` it for real, then call back
    agent = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        void (async () => {
          const body = raw ? JSON.parse(raw) : {};
          if (
            req.url === '/webhook' &&
            body.model === 'plugins.dockercontainer' &&
            body.event === 'created'
          ) {
            const cid = `pbx_${body.object_id}`;
            try {
              await dind('run', '-d', '--name', cid, IMG, 'sleep', '300'); // REAL container
              await fetch(`${paasboxBase}/api/plugins/docker/containers/${body.object_id}/`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ContainerID: cid }),
              });
            } catch (e) {
              console.error('agent run failed:', e);
            }
          }
          res.writeHead(200);
          res.end('ok');
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

    const pb = (m, p, b) =>
      fetch(`${base}${p}`, {
        method: m,
        headers: b ? { 'Content-Type': 'application/json' } : undefined,
        body: b ? JSON.stringify(b) : undefined,
      }).then((r) => r.json());
    await pb('POST', '/api/extras/webhooks/', {
      name: 'docker-agent',
      payload_url: `${agentBase}/webhook`,
      object_types: ['plugins.dockercontainer'],
      events: ['created'],
    });
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

  test('creating a container in paasbox runs a REAL container in dind', async () => {
    const r = await fetch(`${base}/api/plugins/docker/containers/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: hostId, image: imageId, name: 'web' }),
    }).then((x) => x.json());
    const id = r.id;
    const cid = `pbx_${id}`;

    // wait for the agent to create it in dind and call back
    let containerId = null;
    for (let i = 0; i < 120; i++) {
      const got = await fetch(`${base}/api/plugins/docker/containers/${id}/`).then((x) => x.json());
      if (got.ContainerID) {
        containerId = got.ContainerID;
        break;
      }
      await sleep(250);
    }
    assert.equal(containerId, cid, 'agent never reported the ContainerID back to paasbox');

    // assert it is REALLY running inside dind
    const { stdout } = await dind(
      'ps',
      '--filter',
      `name=${cid}`,
      '--format',
      '{{.Names}} {{.Image}}',
    );
    assert.match(
      stdout,
      new RegExp(`${cid}\\s+${IMG.replace('.', '\\.')}`),
      `container not running in dind:\n${stdout}`,
    );
  });
}
