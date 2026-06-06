import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

/** A change broadcast to WebSocket clients after a successful API write. */
export interface ChangeEvent {
  type: 'change';
  event: 'created' | 'updated' | 'deleted';
  /** Content-type of the object (e.g. "dcim.device"). */
  object_type: string;
  /** Physical table name (e.g. "dcim_device"). */
  table: string;
  id: number;
  /** Serialized object for created/updated (omitted for deleted). */
  data?: unknown;
}

const clients = new Set<WebSocket>();

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

/** Attach a WebSocket change-feed to an HTTP server at `path` (default /api/ws/). */
export function attachRealtime(server: Server, path = '/api/ws/'): WebSocketServer {
  const wss = new WebSocketServer({ server, path });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
  return wss;
}
