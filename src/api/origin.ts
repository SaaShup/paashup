// Request-origin defaulting for create requests. A column flagged
// `defaultFromOrigin` (see TableMeta) is auto-populated with the externally visible
// origin of the request when the create body omits it — e.g. a Docker host's
// `netbox_base_url` (the agent's callback URL). Shared by the generic CRUD path
// (server.ts) and plugins whose create is a custom route (e.g. the Docker host route,
// which mints a per-host token).
import type http from 'node:http';
import type { TableMeta } from '../model/meta-types.js';

/** First value of a possibly comma-joined / array-valued header. */
function firstHeader(h: string | string[] | undefined): string | undefined {
  const v = Array.isArray(h) ? h[0] : h;
  return v ? v.split(',')[0]!.trim() : undefined;
}

/**
 * The externally visible origin (`scheme://host`, no path or trailing slash) for this
 * request. Priority: the operator-configured public URL > reverse-proxy headers (only
 * when PB_TRUST_PROXY=1, since they are client-spoofable) > the Host header.
 */
export function externalBaseUrl(req: http.IncomingMessage, fixedBase?: string): string {
  if (fixedBase) return fixedBase; // operator-configured public URL is authoritative
  const trustProxy = process.env.PB_TRUST_PROXY === '1';
  const proto =
    (trustProxy ? firstHeader(req.headers['x-forwarded-proto']) : undefined) ??
    ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  const host =
    (trustProxy ? firstHeader(req.headers['x-forwarded-host']) : undefined) ??
    req.headers.host ??
    'localhost:8000';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/** On create, fill any `defaultFromOrigin` column the body omitted/left empty with `origin`. */
export function applyOriginDefaults(
  meta: TableMeta,
  body: Record<string, unknown>,
  origin: string,
): void {
  for (const c of meta.columns) {
    if (!c.defaultFromOrigin || !c.writable) continue;
    const v = body[c.name];
    if (v === undefined || v === null || v === '') body[c.name] = origin;
  }
}
