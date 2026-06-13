import type { Server, IncomingMessage } from 'node:http';
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
 * `new WebSocket(...)`, so the SPA passes its token as a `Sec-WebSocket-Protocol`
 * value (`pb-token, <key>`) — keeping it out of the URL and access logs. The query
 * string (`?token=` / `?access_token=`) and an `Authorization` header remain fallbacks.
 */
async function wsAuthenticated(db: Db | undefined, req: IncomingMessage): Promise<boolean> {
  if (!db) return false;
  let header = req.headers.authorization;
  if (!header) {
    const proto = req.headers['sec-websocket-protocol'];
    if (proto) {
      const parts = String(proto)
        .split(',')
        .map((s) => s.trim());
      const i = parts.indexOf('pb-token');
      if (i !== -1 && parts[i + 1]) header = `Token ${parts[i + 1]}`;
    }
  }
  if (!header && req.url) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const jwt = q.get('access_token');
    const tok = q.get('token');
    if (jwt) header = `Bearer ${jwt}`;
    else if (tok) header = `Token ${tok}`;
  }
  return (await authenticate(db, header)) != null;
}

/** Attach a WebSocket change-feed to an HTTP server at `path` (default /api/ws/). */
export function attachRealtime(
  server: Server,
  opts: RealtimeOptions = {},
  path = '/api/ws/',
): WebSocketServer {
  wss = new WebSocketServer({
    server,
    path,
    // Accept the SPA's `pb-token` subprotocol (it carries the token in the offered list);
    // echo only `pb-token` back, never the token value.
    handleProtocols: (protocols) => (protocols.has('pb-token') ? 'pb-token' : false),
  });
  wss.on('connection', (ws, req) => {
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
  return wss;
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
