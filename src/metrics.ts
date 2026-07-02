// Prometheus metrics (issue #49). A single registry; every metric instance is created
// once at module load with a fixed, low-cardinality label set (reused — never built
// dynamically), so per-request/per-query overhead is a couple of counter increments.
// Collection is always on (cheap); the `/metrics` *endpoint* is what PB_METRICS toggles.
import * as client from 'prom-client';
import { timingSafeEqual } from 'node:crypto';

const PREFIX = 'paas2box_';
export const registry = new client.Registry();

// Default Node runtime metrics: GC, event-loop lag, active handles/requests, version.
client.collectDefaultMetrics({ register: registry, prefix: PREFIX });

export const metricsContentType = registry.contentType;
export function metricsText(): Promise<string> {
  return registry.metrics();
}

/** The `/metrics` endpoint is served unless PB_METRICS=0 (default on). */
export function metricsEnabled(): boolean {
  return process.env.PB_METRICS !== '0';
}

// ---- HTTP ------------------------------------------------------------------
const httpRequests = new client.Counter({
  name: `${PREFIX}http_requests_total`,
  help: 'HTTP requests by method, route template and status code.',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});
const httpDuration = new client.Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: 'HTTP request duration (seconds) by method and route template.',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});
export function recordHttp(method: string, route: string, status: number, seconds: number): void {
  httpRequests.inc({ method, route, status: String(status) });
  httpDuration.observe({ method, route }, seconds);
}

// ---- auth ------------------------------------------------------------------
const authAttempts = new client.Counter({
  name: `${PREFIX}auth_attempts_total`,
  help: 'Authentication attempts by method (token|oidc) and outcome.',
  labelNames: ['method', 'outcome'],
  registers: [registry],
});
export function recordAuth(method: 'token' | 'oidc', ok: boolean): void {
  authAttempts.inc({ method, outcome: ok ? 'success' : 'failure' });
}

const loginsTotal = new client.Counter({
  name: `${PREFIX}logins_total`,
  help: 'OIDC logins by provider and outcome.',
  labelNames: ['provider', 'outcome'],
  registers: [registry],
});
export function recordLogin(provider: string, ok: boolean): void {
  loginsTotal.inc({ provider, outcome: ok ? 'success' : 'failure' });
}

// ---- database --------------------------------------------------------------
const dbDuration = new client.Histogram({
  name: `${PREFIX}db_query_duration_seconds`,
  help: 'Database operation duration (seconds) by database and op.',
  labelNames: ['database', 'op'],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
});
const dbFailures = new client.Counter({
  name: `${PREFIX}db_query_failures_total`,
  help: 'Database operation failures by database and op.',
  labelNames: ['database', 'op'],
  registers: [registry],
});
export function recordDbOp(database: string, op: string, seconds: number, ok: boolean): void {
  dbDuration.observe({ database, op }, seconds);
  if (!ok) dbFailures.inc({ database, op });
}

let poolGaugeRegistered = false;
/** Register the (MariaDB) connection-pool gauge, read at scrape time. */
export function registerPoolGauge(
  database: string,
  stats: () => { total: number; idle: number },
): void {
  if (poolGaugeRegistered) return;
  poolGaugeRegistered = true;
  new client.Gauge({
    name: `${PREFIX}db_pool_connections`,
    help: 'Database connection-pool size by state (MariaDB).',
    labelNames: ['database', 'state'],
    registers: [registry],
    collect() {
      let s = { total: 0, idle: 0 };
      try {
        s = stats();
      } catch {
        /* best-effort — leave at 0 */
      }
      this.set({ database, state: 'total' }, s.total);
      this.set({ database, state: 'idle' }, s.idle);
    },
  });
}

// ---- Basic Auth guard for /metrics -----------------------------------------
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
/**
 * Whether a `/metrics` request is authorized. When PB_METRICS_USER / PB_METRICS_PASSWORD
 * are set, HTTP Basic Auth is required; otherwise the endpoint is open (for the scraper).
 */
export function metricsAuthorized(authHeader: string | undefined): boolean {
  const user = process.env.PB_METRICS_USER;
  const pass = process.env.PB_METRICS_PASSWORD;
  if (!user && !pass) return true; // no credentials configured → open
  const m = /^Basic\s+(.+)$/i.exec((authHeader ?? '').trim());
  if (!m) return false;
  const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  const u = i >= 0 ? decoded.slice(0, i) : decoded;
  const p = i >= 0 ? decoded.slice(i + 1) : '';
  return safeEq(u, user ?? '') && safeEq(p, pass ?? '');
}
