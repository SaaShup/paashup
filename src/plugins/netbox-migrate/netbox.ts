// Minimal NetBox REST client for the migration tool. Reads collections with an API
// token (NetBox `Authorization: Token <key>`), following pagination. A token with
// access to all objects is recommended so nothing is silently skipped.
import { assertAllowedUrl } from '../../ssrf.js';

export interface NetboxConn {
  url: string; // NetBox base, e.g. https://netbox.example.com
  token: string; // API token
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Token ${token}`, Accept: 'application/json' };
}

/**
 * Fetch a NetBox URL through the SSRF guard, without following redirects — so a
 * malicious/compromised NetBox can't 3xx-pivot the authenticated client to an internal
 * host. Every URL (including each `next` pagination link) goes through here.
 */
async function nbFetch(url: string, token: string, timeoutMs: number): Promise<Response> {
  await assertAllowedUrl(url);
  return fetch(url, {
    headers: authHeaders(token),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Fetch every object from a NetBox collection endpoint (e.g. "/api/dcim/sites/"),
 * following the `next` links. A 404 (endpoint absent in this NetBox) yields []. Other
 * non-2xx responses throw.
 */
export async function nbGetAll(
  conn: NetboxConn,
  endpoint: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next: string | null = `${conn.url.replace(/\/+$/, '')}${endpoint}?limit=200`;
  while (next) {
    const res: Response = await nbFetch(next, conn.token, 60_000);
    if (res.status === 404) return out;
    if (!res.ok) throw new Error(`GET ${endpoint} -> ${res.status}`);
    const page = (await res.json()) as {
      next?: string | null;
      results?: Record<string, unknown>[];
    };
    for (const o of page.results ?? []) out.push(o);
    next = page.next ?? null; // absolute URL on the same host; fetched verbatim
  }
  return out;
}

/**
 * Yield a NetBox collection one page at a time (following `next`), so callers can
 * process/create objects incrementally instead of buffering everything. A 404 yields
 * nothing; other non-2xx responses throw.
 */
export async function* nbPages(
  conn: NetboxConn,
  endpoint: string,
): AsyncGenerator<Record<string, unknown>[]> {
  let next: string | null = `${conn.url.replace(/\/+$/, '')}${endpoint}?limit=200`;
  while (next) {
    const res: Response = await nbFetch(next, conn.token, 60_000);
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`GET ${endpoint} -> ${res.status}`);
    const page = (await res.json()) as {
      next?: string | null;
      results?: Record<string, unknown>[];
    };
    yield page.results ?? [];
    next = page.next ?? null;
  }
}

/** Number of objects in a NetBox collection (the `count` from a 1-item page); 0 if absent. */
export async function nbCount(conn: NetboxConn, endpoint: string): Promise<number> {
  const res = await nbFetch(
    `${conn.url.replace(/\/+$/, '')}${endpoint}?limit=1`,
    conn.token,
    30_000,
  );
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`GET ${endpoint} -> ${res.status}`);
  const page = (await res.json()) as { count?: number };
  return Number(page.count ?? 0);
}

/** Quick connectivity/permission check; returns the NetBox status payload or throws. */
export async function nbStatus(conn: NetboxConn): Promise<Record<string, unknown>> {
  const res = await nbFetch(`${conn.url.replace(/\/+$/, '')}/api/status/`, conn.token, 15_000);
  if (!res.ok) throw new Error(`NetBox /api/status/ -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}
