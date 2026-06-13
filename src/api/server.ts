import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve as resolvePath } from 'node:path';
import type { Db } from '../db/types.js';
import type { TableMeta } from '../model/meta-types.js';
import { allTables, getTable } from '../model/registry.js';
import { Repository, type ListOptions } from '../repository/repository.js';
import { ApiError, ValidationError } from '../errors.js';
import { authenticate, ssoExchange, type AuthOptions } from '../auth.js';
import { listProviders, discover } from '../oidc.js';
import { appVersion } from '../version.js';
import { matchRoute, matchAsset, fireHooks, loadedPlugins } from '../plugins/runtime.js';
import { attachRealtime, broadcast } from '../realtime.js';
import { dispatchWebhooks, type WebhookEventContext } from '../webhooks.js';
import { listUserTokens, createUserToken, revokeUserToken } from '../tokens.js';
import '../journal.js'; // registers the journal-entries entity
import '../configcontext.js'; // registers config-contexts entity + the /render/ route
import { Serializer } from './serializer.js';
import { buildOpenApi } from './openapi.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const SWAGGER_UI_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>paas2box API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>window.onload=()=>SwaggerUIBundle({url:'/api/schema/',dom_id:'#swagger-ui'});</script>
</body></html>`;

export interface ServerOptions {
  db: Db;
  /**
   * Absolute base URL used to build `url`/`next`/`previous` (no trailing slash).
   * If omitted, it is derived per-request from the `Host` header (like NetBox).
   */
  baseUrl?: string;
  /** Token authentication. Off by default; set `{ required: true }` to enforce. */
  auth?: AuthOptions;
  /** Attach a WebSocket change-feed at /api/ws/ that broadcasts write events. */
  realtime?: boolean;
  /** Serve a built SPA (web/dist) for non-/api GET routes (single-container deploy). */
  webRoot?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Serve a static file from `root`, falling back to index.html (SPA routing). */
async function serveStatic(
  res: http.ServerResponse,
  root: string,
  pathname: string,
): Promise<void> {
  const rootAbs = resolvePath(root);
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = resolvePath(rootAbs, `.${rel}`);
  if (filePath !== rootAbs && !filePath.startsWith(rootAbs + '/')) {
    res.writeHead(403);
    res.end();
    return;
  }
  // Hashed assets (js/css/…) are immutable; index.html must never be cached or the SPA
  // goes stale after a rebuild (e.g. a new plugin UI doesn't appear).
  const ext = extname(filePath);
  const cache =
    ext === '.html' || ext === ''
      ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      : { 'Cache-Control': 'public, max-age=31536000, immutable' };
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', ...cache });
    res.end(data);
  } catch {
    try {
      const html = await readFile(resolvePath(rootAbs, 'index.html'));
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }
}

/** Serve a single file under `dir` (no SPA index fallback — a miss is a 404). */
async function serveAsset(res: http.ServerResponse, dir: string, rel: string): Promise<void> {
  const rootAbs = resolvePath(dir);
  const filePath = resolvePath(rootAbs, `.${rel.startsWith('/') ? rel : `/${rel}`}`);
  if (filePath !== rootAbs && !filePath.startsWith(rootAbs + '/')) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

interface Route {
  table: string;
  /** Raw id segment from the URL; coerced to the table's pk type by the repository. */
  id?: string;
}

/** endpoint path -> table name, built from the registry (includes plugin entities). */
function buildCollections(): Map<string, string> {
  const m = new Map<string, string>();
  for (const meta of allTables()) m.set(meta.endpoint, meta.table);
  return m;
}

function emitChange(
  db: Db,
  meta: TableMeta,
  event: 'created' | 'updated' | 'deleted',
  id: number | string,
  data?: unknown,
  ctx?: WebhookEventContext,
): void {
  broadcast({ type: 'change', event, object_type: meta.objectType, table: meta.table, id, data });
  void dispatchWebhooks(db, meta, event, id, data, ctx); // fire-and-forget HTTP webhooks
}

function resolve(pathname: string, collections: Map<string, string>): Route | null {
  const p = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const collection = collections.get(p);
  if (collection) return { table: collection };
  // id segment is kept raw (string); the repository coerces it to the table's pk type
  const m = p.match(/^(.*\/)([^/]+)\/$/);
  if (m && collections.has(m[1]!)) return { table: collections.get(m[1]!)!, id: m[2] };
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

function pageLink(
  base: string,
  endpoint: string,
  sp: URLSearchParams,
  offset: number,
  limit: number,
): string {
  const q = new URLSearchParams(sp);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return `${base}${endpoint}?${q.toString()}`;
}

export function createApiServer(opts: ServerOptions): http.Server {
  const { db } = opts;
  const fixedBase = opts.baseUrl?.replace(/\/$/, '');
  // Built once at server creation — plugins must be loaded before this.
  const collections = buildCollections();
  let schemaDoc: Record<string, unknown> | undefined;

  const server = http.createServer(async (req, res) => {
    const baseUrl = fixedBase ?? `http://${req.headers.host ?? 'localhost:8000'}`;
    const method = req.method ?? 'GET';
    // Baseline security headers on every response (set before routing; writeHead merges).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'"); // anti-clickjacking
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    try {
      const path = (req.url ?? '/').split('?')[0]!.replace(/\/?$/, '/');

      // Public, unauthenticated schema endpoints (like NetBox's /api/schema/).
      if (method === 'GET' && path === '/api/schema/') {
        schemaDoc ??= buildOpenApi();
        return send(res, 200, { ...schemaDoc, servers: [{ url: baseUrl }] });
      }
      if (method === 'GET' && path === '/api/schema/swagger-ui/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(SWAGGER_UI_HTML);
        return;
      }
      // Loaded plugins (name + version) — lets the SPA discover plugins that ship a UI
      // but no entities (e.g. netbox-migrate), so it can probe their /ui/ manifest.
      if (method === 'GET' && path === '/api/plugins/') {
        return send(res, 200, { results: loadedPlugins() });
      }
      // Status/health (public, no DB) — for monitoring, CD checks, and external tooling.
      // {status, version} plus the loaded plugins as a NetBox-style {name: version} map.
      // Public on purpose; the plugin list is already public via /api/plugins/.
      if (method === 'GET' && path === '/api/status/') {
        return send(res, 200, {
          status: 'ok',
          version: appVersion(),
          'node-version': process.version,
          plugins: Object.fromEntries(loadedPlugins().map((p) => [p.name, p.version])),
        });
      }
      // Public OIDC discovery for the SPA login flow (no secrets). Back-compat shape,
      // derived from the first configured provider; the SPA prefers /api/auth/providers/.
      if (method === 'GET' && path === '/api/auth/oidc-config/') {
        const first = listProviders()[0];
        return send(res, 200, {
          enabled: !!first,
          issuer: first?.issuer ?? null,
          client_id: first?.clientId ?? null,
          audience: first?.audience ?? null,
          // when true, the SPA shows a dedicated login page (anonymous access is rejected)
          login_required: !!first && !!opts.auth?.required,
        });
      }
      // Configured SSO providers for the SPA login buttons (public; no secrets). Each
      // entry carries what the browser needs to start the PKCE redirect; the resulting
      // code is exchanged server-side at /api/auth/oidc/exchange/.
      if (method === 'GET' && path === '/api/auth/providers/') {
        const providers = await Promise.all(
          listProviders().map(async (p) => {
            let authorization_endpoint: string | null = null;
            try {
              authorization_endpoint = (await discover(p.issuer)).authorization_endpoint;
            } catch {
              /* discovery unavailable — still list it; the SPA surfaces the error */
            }
            return {
              id: p.id,
              label: p.label,
              kind: p.kind,
              issuer: p.issuer,
              client_id: p.clientId,
              scopes: p.scopes,
              authorization_endpoint,
            };
          }),
        );
        return send(res, 200, { login_required: !!opts.auth?.required, providers });
      }
      // BFF code exchange: the SPA posts the OIDC `code`; we exchange it server-side
      // (holding any client secret) and return a paas2box token. Public — you're logging
      // in — so it sits before the auth gate.
      if (method === 'POST' && path === '/api/auth/oidc/exchange/') {
        const b = (await readBody(req)) as {
          provider?: string;
          code?: string;
          code_verifier?: string;
          redirect_uri?: string;
        };
        if (!b.provider || !b.code || !b.redirect_uri) {
          return send(res, 400, { detail: 'provider, code and redirect_uri are required' });
        }
        const r = await ssoExchange(db, b.provider, {
          code: b.code,
          codeVerifier: b.code_verifier,
          redirectUri: b.redirect_uri,
        });
        if ('error' in r) return send(res, r.status, { detail: r.error });
        return send(res, 200, {
          token: r.token,
          token_id: r.tokenId,
          username: r.username,
          write_enabled: r.writeEnabled,
          expires: r.expires,
        });
      }
      // Static SPA for non-API GET routes (single-container deploy).
      const rawPath = (req.url ?? '/').split('?')[0]!;
      if (opts.webRoot && method === 'GET' && !rawPath.startsWith('/api/')) {
        return serveStatic(res, opts.webRoot, rawPath);
      }
      // Plugin-mounted static assets (a plugin shipping its own web UI). Public, like the SPA.
      if (method === 'GET') {
        const asset = matchAsset(rawPath);
        if (asset) return serveAsset(res, asset.dir, asset.rel);
      }
      // Authentication (token). When `auth.required`, anonymous requests are rejected.
      const auth = await authenticate(db, req.headers.authorization);
      if (opts.auth?.required && !auth) {
        throw new ApiError(403, 'Authentication credentials were not provided.');
      }
      if (auth && !auth.writeEnabled && !SAFE_METHODS.has(method)) {
        throw new ApiError(403, 'This token is read-only.');
      }

      const url = new URL(req.url ?? '/', baseUrl);

      // Self-service API-key management (per-user). Handled inline because it needs
      // the authenticated user, which custom routes don't receive. Requires auth;
      // create/delete are blocked for read-only callers by the guard above.
      if (url.pathname === '/api/users/tokens/' || url.pathname.startsWith('/api/users/tokens/')) {
        if (!auth) throw new ApiError(403, 'Authentication credentials were not provided.');
        if (method === 'GET' && url.pathname === '/api/users/tokens/') {
          const results = await listUserTokens(db, auth.userId);
          return send(res, 200, { count: results.length, next: null, previous: null, results });
        }
        if (method === 'POST' && url.pathname === '/api/users/tokens/') {
          const body = (await readBody(req)) as {
            description?: string;
            expires?: string | null;
            write_enabled?: boolean;
          };
          const created = await createUserToken(db, auth.userId, {
            description: body.description,
            expires: body.expires ?? null,
            writeEnabled: body.write_enabled,
          });
          return send(res, 201, created);
        }
        const m = url.pathname.match(/^\/api\/users\/tokens\/(\d+)\/$/);
        if (method === 'DELETE' && m) {
          const ok = await revokeUserToken(db, auth.userId, Number(m[1]));
          if (!ok) throw new ApiError(404, 'Not found');
          return send(res, 204);
        }
        throw new ApiError(405, `Method ${method} not allowed`);
      }

      // Custom plugin routes take precedence over generic CRUD.
      const custom = matchRoute(method, url.pathname);
      if (custom) {
        const body = SAFE_METHODS.has(method) ? undefined : await readBody(req);
        const result = await custom.route.handler({
          db,
          params: custom.params,
          query: url.searchParams,
          body,
        });
        return send(res, result.status, result.body);
      }

      const route = resolve(url.pathname, collections);
      if (!route) throw new ApiError(404, 'Not found');

      const meta = getTable(route.table) as TableMeta;
      if (meta.readOnly && !SAFE_METHODS.has(method)) {
        throw new ApiError(405, `${meta.model} is read-only`);
      }
      const repo = new Repository<Record<string, unknown>>(db, meta);
      const ser = new Serializer(db, baseUrl);

      // Webhook template/event context: who + which request triggered this change.
      const requestId = randomUUID();
      let username: string | null = null;
      if (auth) {
        try {
          const u = await db.get<{ username: string }>(
            'SELECT username FROM users_user WHERE id = ?',
            [auth.userId],
          );
          username = u?.username ?? null;
        } catch {
          /* users table absent or unreadable → leave username null */
        }
      }
      const evt = (snapshots: WebhookEventContext['snapshots']): WebhookEventContext => ({
        username,
        requestId,
        snapshots,
      });

      if (route.id === undefined) {
        // ---- collection ----
        if (method === 'GET') {
          const listOpts = parseQuery(url.searchParams);
          const page = await repo.list(listOpts);
          const results = await ser.objects(route.table, page.results);
          const next =
            page.offset + page.limit < page.count
              ? pageLink(
                  baseUrl,
                  meta.endpoint,
                  url.searchParams,
                  page.offset + page.limit,
                  page.limit,
                )
              : null;
          const previous =
            page.offset > 0
              ? pageLink(
                  baseUrl,
                  meta.endpoint,
                  url.searchParams,
                  Math.max(0, page.offset - page.limit),
                  page.limit,
                )
              : null;
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
            for (const o of out)
              emitChange(db, meta, 'created', (o as { id: number | string }).id, o, {
                ...evt({ prechange: null, postchange: o }),
              });
            return send(res, 201, out);
          }
          const created = await repo.create(body as Record<string, unknown>);
          const createdId = (created as { id: number | string }).id;
          await fireHooks(db, route.table, 'created', createdId, created);
          const obj = await ser.object(route.table, created);
          emitChange(
            db,
            meta,
            'created',
            createdId,
            obj,
            evt({ prechange: null, postchange: obj }),
          );
          return send(res, 201, obj);
        }
        // NetBox-style bulk update: PATCH/PUT a list of objects (each carrying its id).
        if (method === 'PATCH' || method === 'PUT') {
          const body = await readBody(req);
          if (!Array.isArray(body)) {
            throw new ApiError(400, 'Bulk update expects a list of objects (each with an id).');
          }
          const byName = new Map(meta.columns.map((c) => [c.name, c]));
          const updated = await db.transaction(async (tx) => {
            const r = new Repository<Record<string, unknown>>(tx, meta);
            const rows: Record<string, unknown>[] = [];
            for (const item of body as Record<string, unknown>[]) {
              const itemId = item[meta.pk];
              if (itemId === undefined || itemId === null) {
                throw new ApiError(400, `Each item must include "${meta.pk}".`);
              }
              // Lenient sync: keep only writable scalar columns; coerce an FK given as a
              // nested object to its id, and drop anything that doesn't apply (clients
              // like the Docker agent PATCH the full observed object, nested fields and all).
              const data: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(item)) {
                if (k === meta.pk) continue;
                const col = byName.get(k);
                if (!col || !col.writable) continue;
                if (col.references && v && typeof v === 'object') {
                  const fk = (v as { id?: unknown }).id;
                  if (typeof fk === 'number') data[k] = fk;
                  continue;
                }
                data[k] = v;
              }
              const row = await r.update(itemId as number | string, data);
              if (row) rows.push(row);
            }
            return rows;
          });
          const out = await ser.objects(route.table, updated);
          for (const o of out)
            emitChange(db, meta, 'updated', (o as { id: number | string }).id, o, {
              ...evt({ prechange: null, postchange: o }),
            });
          return send(res, 200, out);
        }
        throw new ApiError(405, `Method ${method} not allowed`);
      }

      // ---- detail ----
      // Coerce the raw URL id segment to the table's pk type (int vs uuid string).
      const rid: number | string = meta.pkKind === 'string' ? route.id! : Number(route.id);
      if (method === 'GET') {
        const row = await repo.retrieve(rid);
        if (!row) throw new ApiError(404, 'Not found');
        return send(res, 200, await ser.object(route.table, row));
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readBody(req);
        // snapshot the object before the change (for {{ snapshots.prechange.* }})
        const before = await repo.retrieve(rid);
        const prechange = before ? await ser.object(route.table, before) : null;
        const updated = await repo.update(rid, body as Record<string, unknown>);
        if (!updated) throw new ApiError(404, 'Not found');
        await fireHooks(db, route.table, 'updated', rid, updated);
        const obj = await ser.object(route.table, updated);
        emitChange(db, meta, 'updated', rid, obj, evt({ prechange, postchange: obj }));
        return send(res, 200, obj);
      }
      if (method === 'DELETE') {
        const before = await repo.retrieve(rid);
        const prechange = before ? await ser.object(route.table, before) : null;
        const ok = await repo.destroy(rid);
        if (!ok) throw new ApiError(404, 'Not found');
        await fireHooks(db, route.table, 'deleted', rid);
        emitChange(db, meta, 'deleted', rid, undefined, evt({ prechange, postchange: null }));
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

  if (opts.realtime) attachRealtime(server, { db, authRequired: !!opts.auth?.required });
  return server;
}
