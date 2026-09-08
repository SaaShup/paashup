// Interactive container terminal, relayed over WebSocket:
//
//   browser ⇄ paasbox  /api/plugins/docker/containers/{id}/ws/?tty=true&command=sh
//             paasbox ⇄ agent    POST {host.endpoint}/api/engine/containers/{cid}/ws
//                                → { path } of a docker-exec-websocket-server stream
//                                ws(s)://{agent}{path}?tty=…&command=…
//
// The browser can't reach the agent ( Basic-auth credentials in the
// host endpoint), so paasbox completes the handshake with the browser first, then opens
// the upstream stream and pipes binary frames both ways untouched. The frame protocol
// (first byte = message code: stdin/stdout/stderr/resize/pause/resume/exit…) is the
// agent's; the SPA speaks it directly. Failures after the handshake are reported as a
// close frame with an application code and the reason text, so the terminal
// can show why.
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { PluginWebSocketRoute } from '../../../plugins/types.js';
import { Repository } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';
import { splitCredentials } from '../../../webhooks.js';
import { T } from '../meta.js';
import { agentFetch, hostEndpoint } from './actions.js';

type Row = Record<string, unknown>;

const wss = new WebSocketServer({ noServer: true });

/** Application close codes sent to the browser (reason carries the message). */
const CLOSE_NOT_FOUND = 4004;
const CLOSE_FORBIDDEN = 4003;
const CLOSE_AGENT_ERROR = 4502;

/** The agent's `{message}` JSON error body, else the raw text. */
function agentMessage(text: string): string {
  try {
    const m = (JSON.parse(text) as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  } catch {
    /* not JSON */
  }
  return text || 'agent error';
}

/** Close reasons are capped at 123 bytes by the protocol. */
const reason = (s: string): string => Buffer.from(s).subarray(0, 120).toString();

const toBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data as ArrayBuffer);

/** A close code we may echo to the other side (1005/1006 and friends are receive-only). */
const forwardable = (code: number): number =>
  (code >= 1000 && code <= 1013 && code !== 1004 && code !== 1005 && code !== 1006) ||
  (code >= 3000 && code <= 4999)
    ? code
    : 1000;

/** Pipe frames both ways; a close/error on either side closes the other. */
function pipe(client: WebSocket, upstream: WebSocket): void {
  const pending: Buffer[] = []; // client frames sent before the upstream is open
  client.on('message', (data) => {
    const buf = toBuffer(data);
    if (upstream.readyState === WebSocket.OPEN) upstream.send(buf, { binary: true });
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push(buf);
  });
  upstream.on('open', () => {
    for (const b of pending) upstream.send(b, { binary: true });
    pending.length = 0;
  });
  upstream.on('message', (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(toBuffer(data), { binary: true });
  });
  upstream.on('close', (code, why) => {
    if (client.readyState === WebSocket.OPEN) client.close(forwardable(code), why.toString());
  });
  upstream.on('error', (err) => {
    if (client.readyState === WebSocket.OPEN) client.close(CLOSE_AGENT_ERROR, reason(err.message));
  });
  client.on('close', () => upstream.terminate());
  client.on('error', () => upstream.terminate());
}

/** The upstream stream URL: the agent's origin with the returned path + the tty/command query. */
function upstreamUrl(endpoint: string, path: string, query: URLSearchParams): URL {
  const u = new URL(splitCredentials(endpoint).url);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = path;
  u.search = '';
  u.searchParams.set('tty', query.get('tty') ?? 'true');
  const command = query.getAll('command');
  for (const c of command.length ? command : ['sh']) u.searchParams.append('command', c);
  return u;
}

export const terminalWebSockets: PluginWebSocketRoute[] = [
  {
    path: '/api/plugins/docker/containers/{id}/ws/',
    handler: ({ db, params, query, req, socket, head }) => {
      wss.handleUpgrade(req, socket, head, (client) => {
        void (async () => {
          const repo = new Repository<Row>(db, getTable(T.container)!);
          const container = await repo.retrieve(Number(params.id));
          if (!container) return client.close(CLOSE_NOT_FOUND, 'Container not found');
          const endpoint = await hostEndpoint(db, (container as Row).host);
          const cid = (container as Row).ContainerID;
          if (!endpoint || typeof cid !== 'string' || !cid) {
            return client.close(CLOSE_NOT_FOUND, 'Container not created on its host yet');
          }
          // 1) ask the agent to open an exec stream for this container
          let path: string;
          try {
            const resp = await agentFetch(`${endpoint}/api/engine/containers/${cid}/ws`, {
              method: 'POST',
            });
            const text = await resp.text();
            if (!resp.ok) {
              const code =
                resp.status === 403
                  ? CLOSE_FORBIDDEN
                  : resp.status === 404
                    ? CLOSE_NOT_FOUND
                    : CLOSE_AGENT_ERROR;
              return client.close(code, reason(agentMessage(text)));
            }
            const p = (JSON.parse(text) as { path?: unknown }).path;
            if (typeof p !== 'string' || !p.startsWith('/')) throw new Error('no stream path');
            path = p;
          } catch (err) {
            return client.close(
              CLOSE_AGENT_ERROR,
              reason(err instanceof Error ? err.message : String(err)),
            );
          }
          if (client.readyState !== WebSocket.OPEN) return; // browser already left
          // 2) connect to the stream (Basic auth from the endpoint's credentials, if any)
          const { authHeader } = splitCredentials(endpoint);
          const upstream = new WebSocket(upstreamUrl(endpoint, path, query), {
            headers: authHeader ? { Authorization: authHeader } : {},
          });
          pipe(client, upstream);
        })().catch((err: unknown) => {
          console.error(err);
          if (client.readyState === WebSocket.OPEN) client.close(1011, 'internal error');
        });
      });
    },
  },
];
