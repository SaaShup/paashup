import http from 'node:http';
import type { Db } from '../db/types.js';
import type { TableMeta } from '../model/meta-types.js';
import { tables } from '../model/metadata.js';
import { Repository, type ListOptions } from '../repository/repository.js';
import { ApiError, ValidationError } from '../errors.js';
import { authenticate, type AuthOptions } from '../auth.js';
import { Serializer } from './serializer.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const RESERVED = new Set(['limit', 'offset', 'ordering', 'q', 'format']);

/** endpoint path -> table name (e.g. "/api/dcim/devices/" -> "dcim_device"). */
const COLLECTIONS = new Map<string, string>();
for (const [table, meta] of Object.entries(tables)) COLLECTIONS.set(meta.endpoint, table);

export interface ServerOptions {
  db: Db;
  /**
   * Absolute base URL used to build `url`/`next`/`previous` (no trailing slash).
   * If omitted, it is derived per-request from the `Host` header (like NetBox).
   */
  baseUrl?: string;
  /** Token authentication. Off by default; set `{ required: true }` to enforce. */
  auth?: AuthOptions;
}

interface Route {
  table: string;
  id?: number;
}

function resolve(pathname: string): Route | null {
  const p = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const collection = COLLECTIONS.get(p);
  if (collection) return { table: collection };
  const m = p.match(/^(.*\/)(\d+)\/$/);
  if (m && COLLECTIONS.has(m[1]!)) return { table: COLLECTIONS.get(m[1]!)!, id: Number(m[2]) };
  return null;
}

function parseQuery(sp: URLSearchParams): ListOptions {
  const opts: ListOptions = { filters: {} };
  for (const key of new Set(sp.keys())) {
    const values = sp.getAll(key);
    if (key === 'limit') opts.limit = Number(values[0]);
    else if (key === 'offset') opts.offset = Number(values[0]);
    else if (key === 'ordering') opts.ordering = values[0];
    else if (key === 'q') opts.q = values[0];
    else if (key === 'format') continue;
    else opts.filters![key] = values.length > 1 ? values : values[0]!;
  }
  return opts;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 10 * 1024 * 1024) reject(new ApiError(413, 'Request body too large'));
      else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

/** Map driver constraint errors to a 400 with a NetBox-ish detail. */
function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  if (/FOREIGN KEY|ER_NO_REFERENCED_ROW|ER_ROW_IS_REFERENCED/i.test(msg + code))
    return new ApiError(400, 'Related object does not exist or is still referenced');
  if (/UNIQUE|ER_DUP_ENTRY|Duplicate entry/i.test(msg + code))
    return new ApiError(400, 'A record with these values already exists');
  if (/NOT NULL|cannot be null|ER_BAD_NULL/i.test(msg + code))
    return new ApiError(400, 'A required field is missing');
  return new ApiError(500, 'Internal server error');
}

function pageLink(base: string, endpoint: string, sp: URLSearchParams, offset: number, limit: number): string {
  const q = new URLSearchParams(sp);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return `${base}${endpoint}?${q.toString()}`;
}

export function createApiServer(opts: ServerOptions): http.Server {
  const { db } = opts;
  const fixedBase = opts.baseUrl?.replace(/\/$/, '');

  return http.createServer(async (req, res) => {
    const baseUrl = fixedBase ?? `http://${req.headers.host ?? 'localhost:8000'}`;
    const method = req.method ?? 'GET';
    try {
      // Authentication (token). When `auth.required`, anonymous requests are rejected.
      const auth = await authenticate(db, req.headers.authorization);
      if (opts.auth?.required && !auth) {
        throw new ApiError(403, 'Authentication credentials were not provided.');
      }
      if (auth && !auth.writeEnabled && !SAFE_METHODS.has(method)) {
        throw new ApiError(403, 'This token is read-only.');
      }

      const url = new URL(req.url ?? '/', baseUrl);
      const route = resolve(url.pathname);
      if (!route) throw new ApiError(404, 'Not found');

      const meta = tables[route.table as keyof typeof tables] as TableMeta;
      const repo = new Repository<Record<string, unknown>>(db, meta);
      const ser = new Serializer(db, baseUrl);

      if (route.id === undefined) {
        // ---- collection ----
        if (method === 'GET') {
          const listOpts = parseQuery(url.searchParams);
          const page = await repo.list(listOpts);
          const results = await ser.objects(route.table, page.results);
          const next = page.offset + page.limit < page.count
            ? pageLink(baseUrl, meta.endpoint, url.searchParams, page.offset + page.limit, page.limit) : null;
          const previous = page.offset > 0
            ? pageLink(baseUrl, meta.endpoint, url.searchParams, Math.max(0, page.offset - page.limit), page.limit) : null;
          return send(res, 200, { count: page.count, next, previous, results });
        }
        if (method === 'POST') {
          const body = await readBody(req);
          if (Array.isArray(body)) {
            const created = await db.transaction(async (tx) => {
              const r = new Repository<Record<string, unknown>>(tx, meta);
              return Promise.all(body.map((b) => r.create(b as Record<string, unknown>)));
            });
            const out = await ser.objects(route.table, created as Record<string, unknown>[]);
            return send(res, 201, out);
          }
          const created = await repo.create(body as Record<string, unknown>);
          return send(res, 201, await ser.object(route.table, created));
        }
        throw new ApiError(405, `Method ${method} not allowed`);
      }

      // ---- detail ----
      if (method === 'GET') {
        const row = await repo.retrieve(route.id);
        if (!row) throw new ApiError(404, 'Not found');
        return send(res, 200, await ser.object(route.table, row));
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readBody(req);
        const updated = await repo.update(route.id, body as Record<string, unknown>);
        if (!updated) throw new ApiError(404, 'Not found');
        return send(res, 200, await ser.object(route.table, updated));
      }
      if (method === 'DELETE') {
        const ok = await repo.destroy(route.id);
        if (!ok) throw new ApiError(404, 'Not found');
        return send(res, 204);
      }
      throw new ApiError(405, `Method ${method} not allowed`);
    } catch (err) {
      const e = toApiError(err);
      if (e.status >= 500) console.error(err);
      // Validation errors return the field-keyed object directly (NetBox shape).
      const body = e instanceof ValidationError && e.detail ? e.detail : { detail: e.message };
      send(res, e.status, body);
    }
  });
}
