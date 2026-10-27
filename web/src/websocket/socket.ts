import type { ServerEvent } from './events.js';
import { getToken } from '../auth/oidc.js';
import { BASE } from '../base.js';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';
type Listener = (e: ServerEvent) => void;
type StatusListener = (s: ConnectionStatus) => void;

/**
 * Native-WebSocket connection manager with auto-reconnect (exponential backoff).
 * Stores subscribe to events/status; it doesn't import them (no circular deps).
 */
export class SocketManager {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private backoff = 500;
  private closedByUser = false;
  status: ConnectionStatus = 'closed';

  constructor(private readonly url: string = defaultUrl()) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.setStatus('connecting');
    // Recompute the credential on every (re)connect so a refreshed token is used.
    const ws = new WebSocket(withCredential(this.url));
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.backoff = 500;
      this.setStatus('open');
    });
    ws.addEventListener('message', (ev) => {
      try {
        this.emit(JSON.parse(ev.data) as ServerEvent);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.addEventListener('close', () => {
      this.setStatus('closed');
      if (!this.closedByUser) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => ws.close());
  }

  private scheduleReconnect(): void {
    const delay = Math.min(this.backoff, 10_000);
    this.backoff = Math.min(this.backoff * 2, 10_000);
    setTimeout(() => {
      if (!this.closedByUser) this.open();
    }, delay);
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  private emit(e: ServerEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }
}

function defaultUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${BASE}/api/ws/`;
}

/**
 * Append the caller's credential to the WS URL. Browsers can't set request headers on a
 * `new WebSocket(...)`, so the server reads the paashup token from the query string.
 * Anonymous if there's no token.
 */
export function withCredential(url: string): string {
  const token = getToken();
  if (!token) return url;
  const u = new URL(url);
  u.searchParams.set('token', token);
  return u.toString();
}

/** Shared singleton used by the app. */
export const socket = new SocketManager();
