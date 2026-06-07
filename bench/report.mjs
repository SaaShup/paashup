#!/usr/bin/env node
// Combine bench/results/*.json into a comparison markdown table.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'results');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
if (!files.length) {
  console.error('no results yet — run bench/run.sh <target> first');
  process.exit(1);
}
const results = files.map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const order = ['paas2box-sqlite', 'paas2box-mariadb', 'netbox'];
results.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const table = (header, rows) => {
  const out = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
};

let md = `# Benchmark results\n\n`;
md += `Requests per phase: ${results[0].requests}, concurrency: ${results[0].concurrency}.\n\n`;

md += `## Deployment & start-up\n\n`;
md += table(
  ['Target', 'Image acquire (build/pull)', 'Boot → first 200'],
  results.map((r) => [r.label, fmtMs(r.startup.acquire_ms), fmtMs(r.startup.boot_ms)]),
);

for (const [phase, title] of [
  ['post', 'POST (create)'],
  ['get_list', 'GET list'],
  ['get_detail', 'GET detail'],
]) {
  md += `\n\n## ${title} — throughput & latency\n\n`;
  md += table(
    ['Target', 'req/s', 'mean', 'p50', 'p95', 'p99', 'errors'],
    results.map((r) => {
      const p = r.phases[phase];
      return [r.label, p.rps, `${p.mean_ms} ms`, `${p.p50_ms} ms`, `${p.p95_ms} ms`, `${p.p99_ms} ms`, p.errors];
    }),
  );
}

// speedup vs netbox, if present
const nb = results.find((r) => r.label === 'netbox');
if (nb) {
  md += `\n\n## paas2box speedup vs NetBox (req/s ratio)\n\n`;
  const rows = results
    .filter((r) => r.label !== 'netbox')
    .map((r) => [
      r.label,
      ...['post', 'get_list', 'get_detail'].map(
        (ph) => `${(r.phases[ph].rps / nb.phases[ph].rps).toFixed(1)}×`,
      ),
    ]);
  md += table(['Target', 'POST', 'GET list', 'GET detail'], rows);
}

md += '\n';
console.log(md);
