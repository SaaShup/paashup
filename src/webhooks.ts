import { createHmac } from 'node:crypto';
import type { Db } from './db/types.js';
import type { TableMeta } from './model/meta-types.js';
import { registerEntity } from './model/registry.js';

export const WEBHOOK_TABLE = 'extras_webhook';

// ---- the Webhook configuration entity (CRUD'd via the API/UI like any other) ----
const HTTP_METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'] as const;
// The CRUD events a webhook can subscribe to (see dispatchWebhooks / matches).
const WEBHOOK_EVENTS = ['created', 'updated', 'deleted'] as const;

const webhookMeta: TableMeta = {
  model: 'Webhook',
  table: WEBHOOK_TABLE,
  section: 'extras',
  endpoint: '/api/extras/webhooks/',
  origin: 'core',
  pk: 'id',
  objectType: 'extras.webhook',
  readOnly: false,
  relations: [],
  counts: [],
  columns: [
    {
      name: 'name',
      column: 'name',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 150,
    },
    {
      name: 'enabled',
      column: 'enabled',
      tsKind: 'boolean',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'object_types',
      column: 'object_types',
      tsKind: 'json',
      nullable: false,
      writable: true,
      required: false,
      objectTypeChoices: true, // multi-select of registered object types
    },
    {
      name: 'events',
      column: 'events',
      tsKind: 'json',
      nullable: false,
      writable: true,
      required: false,
      arrayEnum: WEBHOOK_EVENTS, // multi-select of the CRUD events to fire on
    },
    {
      name: 'conditions',
      column: 'conditions',
      tsKind: 'json',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'payload_url',
      column: 'payload_url',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 500,
    },
    {
      name: 'http_method',
      column: 'http_method',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      enum: HTTP_METHODS,
      enumLabels: Object.fromEntries(HTTP_METHODS.map((m) => [m, m])),
    },
    {
      name: 'http_content_type',
      column: 'http_content_type',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      maxLength: 100,
    },
    {
      name: 'additional_headers',
      column: 'additional_headers',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'body_template',
      column: 'body_template',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
    },
    {
      name: 'secret',
      column: 'secret',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      maxLength: 255,
    },
    {
      name: 'ssl_verification',
      column: 'ssl_verification',
      tsKind: 'boolean',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'description',
      column: 'description',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: false,
      maxLength: 200,
    },
    {
      name: 'created',
      column: 'created',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
    },
    {
      name: 'last_updated',
      column: 'last_updated',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
    },
  ],
};

registerEntity(webhookMeta);

// ---- startup seeding ----------------------------------------------------------
/** A webhook a plugin wants to exist by default (created at startup if missing). */
export interface WebhookSeed {
  readonly name: string;
  /** Object types to fire on, e.g. ['plugins.dockercontainer'] (or ['*']). */
  readonly objectTypes: readonly string[];
  readonly events: readonly ('created' | 'updated' | 'deleted')[];
  readonly payloadUrl: string;
  readonly httpMethod?: string;
  readonly enabled?: boolean;
  readonly sslVerification?: boolean;
}

/**
 * Idempotently ensure each seed webhook exists, matched by its (unique) name —
 * any that are missing get created. Run at startup so a plugin's default
 * integration webhooks are present; deleting one and restarting recreates it.
 * Existing webhooks are never modified (operators stay in control of edits).
 */
export async function ensureWebhooks(db: Db, seeds: readonly WebhookSeed[]): Promise<void> {
  if (!seeds.length) return;
  let existing: Set<string>;
  try {
    const rows = await db.query<{ name: string }>(`SELECT name FROM ${WEBHOOK_TABLE}`);
    existing = new Set(rows.map((r) => r.name));
  } catch {
    return; // table absent (migrations not applied yet) → nothing to seed
  }
  let created = 0;
  for (const s of seeds) {
    if (existing.has(s.name)) continue;
    try {
      await db.execute(
        `INSERT INTO ${WEBHOOK_TABLE}
           (name, enabled, object_types, events, payload_url, http_method, ssl_verification)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          s.name,
          s.enabled === false ? 0 : 1,
          JSON.stringify(s.objectTypes),
          JSON.stringify(s.events),
          s.payloadUrl,
          s.httpMethod ?? 'POST',
          s.sslVerification === false ? 0 : 1,
        ],
      );
      created++;
    } catch {
      /* unique-name race with another starting instance → already created, skip */
    }
  }
  if (created) {
    invalidateWebhooks();
    console.log(`seeded ${created} webhook(s)`);
  }
}

// ---- the (read-only) delivery log entity ----
export const DELIVERY_TABLE = 'extras_webhook_delivery';

const col = (name: string, tsKind: 'string' | 'number' | 'boolean', nullable = false) => ({
  name,
  column: name,
  tsKind,
  nullable,
  writable: false,
  required: false,
});

const deliveryMeta: TableMeta = {
  model: 'WebhookDelivery',
  table: DELIVERY_TABLE,
  section: 'extras',
  endpoint: '/api/extras/webhook-deliveries/',
  origin: 'core',
  pk: 'id',
  objectType: 'extras.webhookdelivery',
  readOnly: true,
  relations: [],
  counts: [],
  columns: [
    col('webhook_name', 'string'),
    col('event', 'string'),
    col('object_type', 'string'),
    col('object_id', 'string', true), // string to hold integer or UUID ids
    col('payload_url', 'string'),
    col('success', 'boolean'),
    col('status_code', 'number', true),
    col('attempts', 'number'),
    col('error', 'string'),
    col('created', 'string', true),
  ],
};

registerEntity(deliveryMeta);

// retry/backoff is configurable via env (kept small + deterministic for tests)
const MAX_TRIES = Math.max(1, Number(process.env.PB_WEBHOOK_RETRIES ?? 2) + 1);
const BACKOFF_MS = Math.max(0, Number(process.env.PB_WEBHOOK_BACKOFF_MS ?? 500));
const REQUEST_TIMEOUT_MS = Math.max(1, Number(process.env.PB_WEBHOOK_TIMEOUT_MS ?? 8000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Human-readable reason for a failed delivery. Node's fetch throws a generic
 * `TypeError: fetch failed` and buries the real cause (DNS/connection/TLS) in
 * `error.cause`; a timeout surfaces as an AbortError. Unwrap both so the delivery
 * log says e.g. "fetch failed: ECONNREFUSED (…)" rather than just "fetch failed".
 */
function describeError(e: unknown): string {
  if (e && typeof e === 'object' && (e as { name?: string }).name === 'TimeoutError') {
    return `request timed out after ${REQUEST_TIMEOUT_MS}ms`;
  }
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      const code = (cause as { code?: string }).code;
      return code ? `${e.message}: ${code} (${cause.message})` : `${e.message}: ${cause.message}`;
    }
    return e.message;
  }
  return String(e);
}

// ---- dispatch ----
interface WebhookRow {
  name: string;
  object_types: unknown;
  events: unknown;
  conditions: unknown;
  payload_url: string;
  http_method: string | null;
  http_content_type: string | null;
  additional_headers: string | null;
  body_template: string | null;
  secret: string | null;
  ssl_verification: number | boolean;
}

interface Webhook {
  name: string;
  objectTypes: string[];
  events: string[];
  conditions: unknown; // null/empty = always; see evalConditions
  url: string;
  method: string;
  contentType: string;
  headers: Record<string, string>;
  bodyTemplate: string; // Jinja-style template; empty = default JSON payload
  secret: string;
  sslVerify: boolean;
}

/** Context for the webhook rendering/dispatch, threaded from the request handler. */
export interface WebhookEventContext {
  username?: string | null;
  requestId?: string | null;
  snapshots?: { prechange: unknown; postchange: unknown } | null;
}

let cache: Webhook[] | null = null;
let insecureAgent: unknown; // lazily created undici Agent for ssl_verification=false

function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseHeaders(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function parseJson(v: unknown): unknown {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
}

async function loadCache(db: Db): Promise<Webhook[]> {
  const base = `name, object_types, events, conditions, payload_url, http_method,
                http_content_type, additional_headers, secret, ssl_verification`;
  let rows: WebhookRow[];
  try {
    // body_template arrives in migration 0010; degrade gracefully on older DBs.
    rows = await db.query<WebhookRow>(
      `SELECT ${base}, body_template FROM ${WEBHOOK_TABLE} WHERE enabled = 1`,
    );
  } catch {
    try {
      rows = await db.query<WebhookRow>(`SELECT ${base} FROM ${WEBHOOK_TABLE} WHERE enabled = 1`);
    } catch {
      return []; // table not present (e.g. migration not applied) → no webhooks
    }
  }
  return rows.map((r) => ({
    name: r.name,
    objectTypes: parseList(r.object_types),
    events: parseList(r.events),
    conditions: parseJson(r.conditions),
    url: r.payload_url,
    method: r.http_method || 'POST',
    contentType: r.http_content_type || 'application/json',
    headers: parseHeaders(r.additional_headers),
    bodyTemplate: r.body_template || '',
    secret: r.secret || '',
    sslVerify: r.ssl_verification !== 0 && r.ssl_verification !== false,
  }));
}

/** Resolve a dotted path; for choice fields ({value,label}) `status` ⇒ status.value. */
function resolvePath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else return undefined;
  }
  if (cur && typeof cur === 'object' && 'value' in (cur as Record<string, unknown>)) {
    return (cur as Record<string, unknown>).value; // choice {value,label}
  }
  return cur;
}

function applyOp(actual: unknown, op: string, value: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'in':
      return Array.isArray(value) && value.includes(actual);
    case 'contains':
      return typeof actual === 'string' && actual.includes(String(value));
    case 'gt':
      return Number(actual) > Number(value);
    case 'gte':
      return Number(actual) >= Number(value);
    case 'lt':
      return Number(actual) < Number(value);
    case 'lte':
      return Number(actual) <= Number(value);
    case 'empty':
      return value
        ? actual === null || actual === undefined || actual === ''
        : !(actual === null || actual === undefined || actual === '');
    default:
      return false;
  }
}

/**
 * NetBox-style conditions. Supports `{and:[…]}` / `{or:[…]}`, leaf rules
 * `{attr, op, value}`, and a plain `{field: value}` map (AND of equality, where a
 * choice field matches its `.value`). Empty/null ⇒ always true.
 */
function evalConditions(cond: unknown, data: Record<string, unknown>): boolean {
  if (!cond || typeof cond !== 'object') return true;
  const c = cond as Record<string, unknown>;
  if (Array.isArray(c.and)) return c.and.every((s) => evalConditions(s, data));
  if (Array.isArray(c.or)) return c.or.some((s) => evalConditions(s, data));
  if (typeof c.attr === 'string') {
    return applyOp(resolvePath(data, c.attr), String(c.op ?? 'eq'), c.value);
  }
  return Object.entries(c).every(([k, v]) => resolvePath(data, k) === v);
}

/** Invalidate the cached webhook config (call when the webhook table changes). */
export function invalidateWebhooks(): void {
  cache = null;
}

function matches(wh: Webhook, meta: TableMeta, event: string): boolean {
  if (!wh.events.includes(event)) return false;
  return (
    wh.objectTypes.includes('*') ||
    wh.objectTypes.includes(meta.objectType) ||
    wh.objectTypes.includes(meta.table)
  );
}

interface DeliveryResult {
  success: boolean;
  status: number | null;
  attempts: number;
  error: string;
  redacted: string; // the (rendered) target URL with any password masked, for logs
}

// ---- Jinja-style templating (a documented subset) -----------------------------
// payload_url, additional_headers and body_template are rendered with the event
// context: {{ event }} {{ model }} {{ timestamp }} {{ username }} {{ request_id }}
// {{ data.* }} {{ snapshots.prechange.* }} {{ snapshots.postchange.* }} — dotted
// paths with optional filters: | default('x') | urlencode | lower | upper.

function applyFilter(v: unknown, filter: string): unknown {
  const m = /^(\w+)\s*(?:\(\s*(['"]?)(.*?)\2\s*\))?$/.exec(filter);
  if (!m) return v;
  const arg = m[3];
  switch (m[1]) {
    case 'default':
      return v === undefined || v === null || v === '' ? (arg ?? '') : v;
    case 'urlencode':
      return v == null ? v : encodeURIComponent(String(v));
    case 'lower':
      return v == null ? v : String(v).toLowerCase();
    case 'upper':
      return v == null ? v : String(v).toUpperCase();
    default:
      return v;
  }
}

/** Render `{{ path | filter… }}` placeholders against the context (undefined → ''). */
export function renderTemplate(tpl: string, ctx: Record<string, unknown>): string {
  if (!tpl || !tpl.includes('{{')) return tpl;
  return tpl.replace(/\{\{(.*?)\}\}/g, (_, expr: string) => {
    const parts = expr.split('|').map((s) => s.trim());
    let v = resolvePath(ctx, parts[0]!);
    for (let i = 1; i < parts.length; i++) v = applyFilter(v, parts[i]!);
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

/**
 * Support credentials embedded in the payload URL (http://user:pass@host). Node's
 * fetch() rejects URLs that include userinfo, so we move them into a Basic auth
 * header and return the cleaned URL. `redacted` masks the password for logs.
 */
function splitCredentials(rawUrl: string): {
  url: string;
  authHeader?: string;
  redacted: string;
} {
  try {
    const u = new URL(rawUrl);
    if (!u.username && !u.password) return { url: rawUrl, redacted: rawUrl };
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    u.username = '';
    u.password = '';
    const url = u.toString();
    return {
      url,
      authHeader: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
      redacted: `${u.protocol}//${user}:***@${u.host}${u.pathname}${u.search}`,
    };
  } catch {
    return { url: rawUrl, redacted: rawUrl }; // not parseable — let fetch surface it
  }
}

async function deliver(
  wh: Webhook,
  body: string,
  ctx: Record<string, unknown>,
): Promise<DeliveryResult> {
  // Render the URL and header values with the event context (NetBox-style templating).
  const { url: targetUrl, authHeader, redacted } = splitCredentials(renderTemplate(wh.url, ctx));
  const headers: Record<string, string> = { 'Content-Type': wh.contentType };
  for (const [k, v] of Object.entries(wh.headers)) headers[k] = renderTemplate(v, ctx);
  // URL-embedded credentials become Basic auth, unless an explicit Authorization is set.
  if (authHeader && !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
    headers['Authorization'] = authHeader;
  }
  if (wh.secret) {
    headers['X-Hook-Signature'] = createHmac('sha512', wh.secret).update(body).digest('hex');
  }
  const hasBody = wh.method !== 'GET' && wh.method !== 'DELETE';
  const opts: RequestInit = { method: wh.method, headers, ...(hasBody ? { body } : {}) };
  if (!wh.sslVerify) {
    try {
      if (!insecureAgent) {
        const { Agent } = await import('undici');
        insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
      }
      opts.dispatcher = insecureAgent as RequestInit['dispatcher'];
    } catch {
      /* undici unavailable: fall back to verified TLS */
    }
  }

  let status: number | null = null;
  let error = '';
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const res = await fetch(targetUrl, {
        ...opts,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = res.status;
      if (res.ok) return { success: true, status, attempts: attempt, error: '', redacted };
      // Surface why the endpoint rejected: status line + a snippet of the body.
      error = `HTTP ${res.status} ${res.statusText}`.trim();
      const snippet = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (snippet) error += ` — ${snippet}`;
    } catch (e) {
      status = null;
      error = describeError(e);
    }
    if (attempt < MAX_TRIES) await sleep(BACKOFF_MS * 2 ** (attempt - 1)); // exp. backoff
  }
  return { success: false, status, attempts: MAX_TRIES, error, redacted };
}

/**
 * Fire any matching webhooks for a CRUD event. Fire-and-forget: failures are
 * logged but never affect the API response. Works for core and plugin entities
 * alike (called from the generic CRUD path).
 */
export async function dispatchWebhooks(
  db: Db,
  meta: TableMeta,
  event: 'created' | 'updated' | 'deleted',
  id: number | string,
  data?: unknown,
  ctx?: WebhookEventContext,
): Promise<void> {
  if (meta.table === WEBHOOK_TABLE) cache = null; // config changed → reload next time
  if (meta.table === DELIVERY_TABLE) return; // never recurse on the log itself
  cache ??= await loadCache(db);
  if (!cache.length) return;

  // A delete carries no post-state, but NetBox's payload `data` is the object's
  // last known state — fall back to the prechange snapshot so `{{ data.* }}`,
  // the default payload, and conditions all see the deleted object.
  const effectiveData = data ?? (event === 'deleted' ? (ctx?.snapshots?.prechange ?? null) : null);
  const obj = (effectiveData ?? {}) as Record<string, unknown>;
  const targets = cache.filter(
    (wh) => matches(wh, meta, event) && evalConditions(wh.conditions, obj),
  );
  if (!targets.length) return;

  const timestamp = new Date().toISOString();
  // Template/render context (NetBox-compatible keys).
  const tctx: Record<string, unknown> = {
    event,
    model: meta.objectType,
    timestamp,
    username: ctx?.username ?? null,
    request_id: ctx?.requestId ?? null,
    data: effectiveData,
    snapshots: ctx?.snapshots ?? { prechange: null, postchange: data ?? null },
  };
  // Default JSON payload (used when no body_template is configured).
  const defaultPayload = JSON.stringify({
    event,
    timestamp,
    model: meta.objectType,
    object_id: id,
    data: effectiveData,
  });

  await Promise.all(
    targets.map(async (wh) => {
      const body = wh.bodyTemplate ? renderTemplate(wh.bodyTemplate, tctx) : defaultPayload;
      const r = await deliver(wh, body, tctx);
      if (!r.success) {
        console.error(
          `[webhook] "${wh.name}" -> ${r.redacted} failed after ${r.attempts}: ${r.error}`,
        );
      }
      await logDelivery(db, wh, meta, event, id, r);
    }),
  );
}

async function logDelivery(
  db: Db,
  wh: Webhook,
  meta: TableMeta,
  event: string,
  id: number | string,
  r: DeliveryResult,
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO ${DELIVERY_TABLE}
         (webhook_name, event, object_type, object_id, payload_url, success, status_code, attempts, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        wh.name,
        event,
        meta.objectType,
        id,
        r.redacted, // the rendered target URL, password masked — never log the secret
        r.success ? 1 : 0,
        r.status,
        r.attempts,
        r.error,
      ],
    );
  } catch {
    /* delivery-log table absent → skip logging */
  }
}
