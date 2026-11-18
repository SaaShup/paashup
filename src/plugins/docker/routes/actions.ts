// Docker-agent proxy actions, ported from the source DRF @action endpoints. Each
// proxies an HTTP call to the owning host's agent (`host.endpoint` + /api/engine/...)
// and maps an upstream failure to 502. Note: paashup's plugin response layer is
// JSON-only, so `logs` text is returned JSON-encoded (the source used text/html).

import type { Db } from '../../../db/types.js';
import type { PluginRoute, PluginRouteResult } from '../../../plugins/types.js';
import { Repository } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';
import { ValidationError } from '../../../errors.js';
import { splitCredentials } from '../../../webhooks.js';
import { withAgentDispatcher, dispatchedFetch } from '../tls.js';
import { T } from '../meta.js';
import { serializeImage } from '../serialize.js';

type Row = Record<string, unknown>;

const notFound: PluginRouteResult = { status: 404, body: { detail: 'Not found' } };
const badGateway = (payload: unknown): PluginRouteResult => ({
  status: 502,
  body: { success: false, payload },
});

/**
 * fetch() against the agent, with URL-embedded credentials turned into Basic auth. An https
 * URL is pinned to `ca` (the CA trusted on first use when the host was added) — without it,
 * an https call is refused by the platform's default trust store, since the agent's CA is
 * self-signed.
 */
export async function agentFetch(
  rawUrl: string,
  init: RequestInit = {},
  ca?: string,
): Promise<Response> {
  const { url, authHeader } = splitCredentials(rawUrl);
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (authHeader && !headers.Authorization) headers.Authorization = authHeader;
  const opts = await withAgentDispatcher({ ...init, headers }, url, ca);
  return dispatchedFetch(url, opts);
}

/** A host's agent endpoint and its pinned CA (undefined for a plain http endpoint). */
export async function hostAgent(
  db: Db,
  hostId: unknown,
): Promise<{ endpoint: string; ca?: string } | undefined> {
  const row = await db.get<{ endpoint: string; ca_pem: string | null }>(
    `SELECT endpoint, ca_pem FROM ${T.host} WHERE id = ?`,
    [Number(hostId)],
  );
  return row ? { endpoint: row.endpoint, ca: row.ca_pem ?? undefined } : undefined;
}

export const actionRoutes: PluginRoute[] = [
  {
    // POST /api/plugins/docker/images/{id}/force_pull/
    method: 'POST',
    path: '/api/plugins/docker/images/{id}/force_pull/',
    handler: async ({ db, params }) => {
      const repo = new Repository<Row>(db, getTable(T.image)!);
      const image = await repo.retrieve(Number(params.id));
      if (!image) return notFound;
      const agent = await hostAgent(db, (image as Row).host);
      if (!agent) return notFound;
      const data = { ...(await serializeImage(db, image as Row)), force: true };
      try {
        const resp = await agentFetch(
          `${agent.endpoint}/api/engine/images`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data }),
          },
          agent.ca,
        );
        const text = await resp.text();
        if (!resp.ok) return badGateway(text);
        return { status: 200, body: { success: true, payload: text ? JSON.parse(text) : null } };
      } catch (err) {
        return badGateway(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    // GET /api/plugins/docker/containers/{id}/logs/
    method: 'GET',
    path: '/api/plugins/docker/containers/{id}/logs/',
    handler: async ({ db, params }) => {
      const repo = new Repository<Row>(db, getTable(T.container)!);
      const container = await repo.retrieve(Number(params.id));
      if (!container) return notFound;
      const agent = await hostAgent(db, (container as Row).host);
      const cid = (container as Row).ContainerID;
      if (!agent) return notFound;
      try {
        const resp = await agentFetch(
          `${agent.endpoint}/api/engine/containers/${cid}/logs`,
          {},
          agent.ca,
        );
        const text = await resp.text();
        if (!resp.ok) return { status: 502, body: text };
        return { status: 200, body: text };
      } catch (err) {
        return { status: 502, body: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    // POST /api/plugins/docker/containers/{id}/exec/
    method: 'POST',
    path: '/api/plugins/docker/containers/{id}/exec/',
    handler: async ({ db, params, body }) => {
      const cmd = (body as { cmd?: unknown } | null)?.cmd;
      if (!Array.isArray(cmd) || !cmd.every((c) => typeof c === 'string')) {
        throw new ValidationError('invalid cmd', { cmd: ['Expected a list of strings.'] });
      }
      const repo = new Repository<Row>(db, getTable(T.container)!);
      const container = await repo.retrieve(Number(params.id));
      if (!container) return notFound;
      const agent = await hostAgent(db, (container as Row).host);
      const cid = (container as Row).ContainerID;
      if (!agent) return notFound;
      try {
        const resp = await agentFetch(
          `${agent.endpoint}/api/engine/containers/${cid}/exec`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd }),
          },
          agent.ca,
        );
        const text = await resp.text();
        if (!resp.ok) return { status: 502, body: text };
        return { status: 200, body: text ? JSON.parse(text) : null };
      } catch (err) {
        return { status: 502, body: err instanceof Error ? err.message : String(err) };
      }
    },
  },
];
