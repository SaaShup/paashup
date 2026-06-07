import { createHmac } from 'node:crypto';
import type { Db } from './db/types.js';
import type { TableMeta } from './model/meta-types.js';
import { registerEntity } from './model/registry.js';

export const WEBHOOK_TABLE = 'extras_webhook';

// ---- the Webhook configuration entity (CRUD'd via the API/UI like any other) ----
const HTTP_METHODS = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'] as const;

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
    },
    {
      name: 'events',
      column: 'events',
      tsKind: 'json',
      nullable: false,
      writable: true,
      required: false,
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
    col('object_id', 'number', true),
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  secret: string;
  sslVerify: boolean;
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
  try {
    const rows = await db.query<WebhookRow>(
      `SELECT name, object_types, events, conditions, payload_url, http_method, http_content_type,
              additional_headers, secret, ssl_verification
         FROM ${WEBHOOK_TABLE} WHERE enabled = 1`,
    );
    return rows.map((r) => ({
      name: r.name,
      objectTypes: parseList(r.object_types),
      events: parseList(r.events),
      conditions: parseJson(r.conditions),
      url: r.payload_url,
      method: r.http_method || 'POST',
      contentType: r.http_content_type || 'application/json',
      headers: parseHeaders(r.additional_headers),
      secret: r.secret || '',
      sslVerify: r.ssl_verification !== 0 && r.ssl_verification !== false,
    }));
  } catch {
    return []; // table not present (e.g. migration not applied) → no webhooks
  }
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
}

async function deliver(wh: Webhook, body: string): Promise<DeliveryResult> {
  const headers: Record<string, string> = { 'Content-Type': wh.contentType, ...wh.headers };
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
      const res = await fetch(wh.url, { ...opts, signal: AbortSignal.timeout(8000) });
      status = res.status;
      if (res.ok) return { success: true, status, attempts: attempt, error: '' };
      error = `HTTP ${res.status}`;
    } catch (e) {
      status = null;
      error = e instanceof Error ? e.message : String(e);
    }
    if (attempt < MAX_TRIES) await sleep(BACKOFF_MS * 2 ** (attempt - 1)); // exp. backoff
  }
  return { success: false, status, attempts: MAX_TRIES, error };
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
  id: number,
  data?: unknown,
): Promise<void> {
  if (meta.table === WEBHOOK_TABLE) cache = null; // config changed → reload next time
  if (meta.table === DELIVERY_TABLE) return; // never recurse on the log itself
  cache ??= await loadCache(db);
  if (!cache.length) return;

  const obj = (data ?? {}) as Record<string, unknown>;
  const targets = cache.filter(
    (wh) => matches(wh, meta, event) && evalConditions(wh.conditions, obj),
  );
  if (!targets.length) return;

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    model: meta.objectType,
    object_id: id,
    data: data ?? null,
  });

  await Promise.all(
    targets.map(async (wh) => {
      const r = await deliver(wh, payload);
      if (!r.success) {
        console.error(`[webhook] "${wh.name}" -> ${wh.url} failed after ${r.attempts}: ${r.error}`);
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
  id: number,
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
        wh.url,
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
