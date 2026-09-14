import { STATUS_CODES, type Server, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Db } from './db/types.js';
import { authenticate } from './auth.js';

/** A change broadcast to WebSocket clients after a successful API write. */
export interface ChangeEvent {
  type: 'change';
  event: 'created' | 'updated' | 'deleted';
  /** Content-type of the object (e.g. "dcim.device"). */
  object_type: string;
  /** Physical table name (e.g. "dcim_device"). */
  table: string;
  id: number | string;
  /** Serialized object for created/updated (omitted for deleted). */
  data?: unknown;
}

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

/** Push a change to every connected client. No-op if none. */
export function broadcast(msg: ChangeEvent): void {
  if (!clients.size) return;
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

export function clientCount(): number {
  return clients.size;
}

export interface RealtimeOptions {
  db?: Db;
  /** When true, reject WebSocket clients that don't present a valid token. */
  authRequired?: boolean;
}

/**
 * Authenticate a WebSocket handshake. Browsers can't set request headers on a
 * `new WebSocket(...)`, so the SPA passes its credential in the query string:
 *   `?access_token=<jwt>` (OIDC bearer)  or  `?token=<key>` (static API token).
 * Non-browser clients may still use the `Authorization` header.
 */
export async function wsAuthenticated(db: Db | undefined, req: IncomingMessage): Promise<boolean> {
  if (!db) return false;
  let header = req.headers.authorization;
  if (!header && req.url) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const jwt = q.get('access_token');
    const tok = q.get('token');
    if (jwt) header = `Bearer ${jwt}`;
    else if (tok) header = `Token ${tok}`;
  }
  return (await authenticate(db, header)) != null;
}

// ---- HTTP upgrade router ---------------------------------------------------------------
// One `upgrade` listener per http.Server dispatching on the request path, so several
// WebSocket endpoints can share the server.

export type UpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void | Promise<void>;

interface UpgradeRoute {
  match: (pathname: string) => boolean;
  handle: UpgradeHandler;
}

const upgradeRoutes = new WeakMap<Server, UpgradeRoute[]>();

/** Refuse an upgrade with a plain HTTP response and close the socket. */
export function rejectUpgrade(socket: Duplex, status: number, message?: string): void {
  const text = message ?? STATUS_CODES[status] ?? '';
  socket.write(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
  );
  socket.destroy();
}

export function addUpgradeRoute(
  server: Server,
  match: (pathname: string) => boolean,
  handle: UpgradeHandler,
): void {
  let list = upgradeRoutes.get(server);
  if (!list) {
    list = [];
    upgradeRoutes.set(server, list);
    const routes = list;
    server.on('upgrade', (req, socket, head) => {
      const rawUrl = req.url ?? '/';
      const apiIdx = rawUrl.split('?')[0]!.indexOf('/api/');
      if (apiIdx > 0) req.url = rawUrl.slice(apiIdx);
      const raw = new URL(req.url ?? '/', 'http://localhost').pathname;
      const pathname = raw.endsWith('/') ? raw : `${raw}/`;
      const r = routes.find((x) => x.match(pathname));
      if (!r) return rejectUpgrade(socket, 404);
      Promise.resolve(r.handle(req, socket, head)).catch((err: unknown) => {
        console.error(err);
        if (!socket.destroyed) rejectUpgrade(socket, 500);
      });
    });
  }
  list.push({ match, handle });
}

/** Attach a WebSocket change-feed to an HTTP server at `path` (default /api/ws/). */
export function attachRealtime(
  server: Server,
  opts: RealtimeOptions = {},
  path = '/api/ws/',
): WebSocketServer {
  const feed = new WebSocketServer({ noServer: true });
  wss = feed;
  addUpgradeRoute(
    server,
    (p) => p === path,
    (req, socket, head) =>
      feed.handleUpgrade(req, socket, head, (ws) => feed.emit('connection', ws, req)),
  );
  feed.on('connection', (ws, req) => {
    // When auth is required, reject anonymous/invalid clients — otherwise the feed
    // would stream every create/update/delete (with data) to anyone who connects.
    void (async () => {
      if (opts.authRequired && !(await wsAuthenticated(opts.db, req))) {
        ws.close(1008, 'authentication required');
        return;
      }
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    })();
  });
  return feed;
}

/**
 * Tear down the change-feed on shutdown: terminate every client socket and close
 * the WebSocket server. Open WS connections otherwise keep `http.Server.close()`
 * from ever completing, so the process would hang on SIGINT/SIGTERM.
 */
export function closeRealtime(): void {
  for (const ws of clients) ws.terminate();
  clients.clear();
  wss?.close();
  wss = null;
}
