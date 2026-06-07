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

// ---- dispatch ----
interface WebhookRow {
  name: string;
  object_types: unknown;
  events: unknown;
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

async function loadCache(db: Db): Promise<Webhook[]> {
  try {
    const rows = await db.query<WebhookRow>(
      `SELECT name, object_types, events, payload_url, http_method, http_content_type,
              additional_headers, secret, ssl_verification
         FROM ${WEBHOOK_TABLE} WHERE enabled = 1`,
    );
    return rows.map((r) => ({
      name: r.name,
      objectTypes: parseList(r.object_types),
      events: parseList(r.events),
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

async function deliver(wh: Webhook, body: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': wh.contentType, ...wh.headers };
  if (wh.secret) {
    headers['X-Hook-Signature'] = createHmac('sha512', wh.secret).update(body).digest('hex');
  }
  const hasBody = wh.method !== 'GET' && wh.method !== 'DELETE';
  const opts: RequestInit = {
    method: wh.method,
    headers,
    signal: AbortSignal.timeout(8000),
    ...(hasBody ? { body } : {}),
  };
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
  await fetch(wh.url, opts);
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
  cache ??= await loadCache(db);
  if (!cache.length) return;
  const targets = cache.filter((wh) => matches(wh, meta, event));
  if (!targets.length) return;

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    model: meta.objectType,
    object_id: id,
    data: data ?? null,
  });
  const results = await Promise.allSettled(targets.map((wh) => deliver(wh, payload)));
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === 'rejected') {
      console.error(`[webhook] "${targets[i]!.name}" -> ${targets[i]!.url} failed:`, r.reason);
    }
  }
}
