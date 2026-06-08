// Docker-agent proxy actions, ported from the source DRF @action endpoints. Each
// proxies an HTTP call to the owning host's agent (`host.endpoint` + /api/engine/...)
// and maps an upstream failure to 502. Note: paasbox's plugin response layer is
// JSON-only, so `logs` text is returned JSON-encoded (the source used text/html).
import type { Db } from '../../../db/types.js';
import type { PluginRoute, PluginRouteResult } from '../../../plugins/types.js';
import { Repository } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';
import { ValidationError } from '../../../errors.js';
import { T } from '../meta.js';
import { serializeImage } from '../serialize.js';

type Row = Record<string, unknown>;

const notFound: PluginRouteResult = { status: 404, body: { detail: 'Not found' } };
const badGateway = (payload: unknown): PluginRouteResult => ({
  status: 502,
  body: { success: false, payload },
});

async function hostEndpoint(db: Db, hostId: unknown): Promise<string | undefined> {
  const row = await db.get<{ endpoint: string }>(`SELECT endpoint FROM ${T.host} WHERE id = ?`, [
    Number(hostId),
  ]);
  return row?.endpoint;
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
      const endpoint = await hostEndpoint(db, (image as Row).host);
      if (!endpoint) return notFound;
      const data = { ...(await serializeImage(db, image as Row)), force: true };
      try {
        const resp = await fetch(`${endpoint}/api/engine/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
        });
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
      const endpoint = await hostEndpoint(db, (container as Row).host);
      const cid = (container as Row).ContainerID;
      if (!endpoint) return notFound;
      try {
        const resp = await fetch(`${endpoint}/api/engine/containers/${cid}/logs`);
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
      const endpoint = await hostEndpoint(db, (container as Row).host);
      const cid = (container as Row).ContainerID;
      if (!endpoint) return notFound;
      try {
        const resp = await fetch(`${endpoint}/api/engine/containers/${cid}/exec`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd }),
        });
        const text = await resp.text();
        if (!resp.ok) return { status: 502, body: text };
        return { status: 200, body: text ? JSON.parse(text) : null };
      } catch (err) {
        return { status: 502, body: err instanceof Error ? err.message : String(err) };
      }
    },
  },
];
