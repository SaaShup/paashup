#!/usr/bin/env node
// Target-agnostic API benchmark for paasbox vs NetBox. Hits a NetBox-compatible
// endpoint (dcim/manufacturers) and reports latency percentiles + throughput for
// three phases: POST (create), GET list, GET detail. Works against any base URL
// with an optional `Authorization: Token` header.
//
// Usage:
//   node bench/bench.mjs --base http://localhost:8000 [--token T] \
//       [--requests 500] [--concurrency 16] [--json out.json] [--label name]
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const BASE = (args.base ?? 'http://localhost:8000').replace(/\/$/, '');
const TOKEN = args.token;
const N = Number(args.requests ?? 500);
const CONCURRENCY = Number(args.concurrency ?? 16);
const LABEL = args.label ?? BASE;
const ENDPOINT = '/api/dcim/manufacturers/';
const RUN = Date.now().toString(36);

const headers = (body) => ({
  ...(body ? { 'Content-Type': 'application/json' } : {}),
  ...(TOKEN ? { Authorization: `Token ${TOKEN}` } : {}),
});

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

/** Run `tasks` (thunks returning a {ms, ok}) with a fixed concurrency pool. */
async function pool(tasks, concurrency) {
  const lat = [];
  let errors = 0;
  let next = 0;
  const wall0 = performance.now();
  async function worker() {
    while (next < tasks.length) {
      const r = await tasks[next++]();
      if (r.ok) lat.push(r.ms);
      else errors++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wall = performance.now() - wall0;
  lat.sort((a, b) => a - b);
  const sum = lat.reduce((a, b) => a + b, 0);
  return {
    requests: tasks.length,
    ok: lat.length,
    errors,
    wall_ms: +wall.toFixed(1),
    rps: +((lat.length / wall) * 1000).toFixed(1),
    mean_ms: +(lat.length ? sum / lat.length : 0).toFixed(2),
    p50_ms: +pct(lat, 50).toFixed(2),
    p95_ms: +pct(lat, 95).toFixed(2),
    p99_ms: +pct(lat, 99).toFixed(2),
    max_ms: +(lat.length ? lat[lat.length - 1] : 0).toFixed(2),
  };
}

async function timed(fn) {
  const t0 = performance.now();
  try {
    const res = await fn();
    return { ms: performance.now() - t0, ok: res.ok, status: res.status, body: res };
  } catch {
    return { ms: performance.now() - t0, ok: false };
  }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(body),
    body: body ? JSON.stringify(body) : undefined,
  });
  // drain body so the connection is reusable
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function main() {
  console.error(`# bench ${LABEL}: ${N} requests, concurrency ${CONCURRENCY}`);

  // warmup (not measured)
  for (let i = 0; i < 5; i++) await req('GET', `${ENDPOINT}?limit=1`).catch(() => {});

  // ---- POST: create N manufacturers ----
  const createdIds = [];
  const postTasks = Array.from({ length: N }, (_, i) => async () => {
    const r = await timed(() => req('POST', ENDPOINT, { name: `bench-${RUN}-${i}`, slug: `bench-${RUN}-${i}` }));
    if (r.ok && r.body?.text) {
      try {
        createdIds.push(JSON.parse(r.body.text).id);
      } catch {
        /* ignore */
      }
    }
    return r;
  });
  const post = await pool(postTasks, CONCURRENCY);

  // ---- GET list ----
  const listTasks = Array.from({ length: N }, () => () =>
    timed(() => req('GET', `${ENDPOINT}?limit=50`)),
  );
  const getList = await pool(listTasks, CONCURRENCY);

  // ---- GET detail (random existing ids) ----
  const ids = createdIds.length ? createdIds : [1];
  const detailTasks = Array.from({ length: N }, (_, i) => () =>
    timed(() => req('GET', `${ENDPOINT}${ids[i % ids.length]}/`)),
  );
  const getDetail = await pool(detailTasks, CONCURRENCY);

  const result = {
    label: LABEL,
    base: BASE,
    requests: N,
    concurrency: CONCURRENCY,
    phases: { post, get_list: getList, get_detail: getDetail },
  };

  // human table to stderr, JSON to stdout/file
  const rows = [
    ['phase', 'ok', 'err', 'rps', 'mean', 'p50', 'p95', 'p99', 'max'],
    ['POST', post.ok, post.errors, post.rps, post.mean_ms, post.p50_ms, post.p95_ms, post.p99_ms, post.max_ms],
    ['GET list', getList.ok, getList.errors, getList.rps, getList.mean_ms, getList.p50_ms, getList.p95_ms, getList.p99_ms, getList.max_ms],
    ['GET detail', getDetail.ok, getDetail.errors, getDetail.rps, getDetail.mean_ms, getDetail.p50_ms, getDetail.p95_ms, getDetail.p99_ms, getDetail.max_ms],
  ];
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  for (const r of rows) console.error(r.map((v, c) => String(v).padEnd(w[c])).join('  '));

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(result, null, 2));
    console.error(`\nwrote ${args.json}`);
  } else {
    console.log(JSON.stringify(result));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
