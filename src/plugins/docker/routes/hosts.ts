// Host write routes (PUT/PATCH). Hosts otherwise use generic CRUD, but a refresh —
// `operation` set to "refresh" — needs side effects the generic path can't express:
// the host is marked "refreshing" and its discovered resources (containers, images,
// volumes, networks) are purged so the agent can re-report them from scratch. The
// host's registries are kept. All of this happens in one transaction, before the
// host row is stored, so a failed update rolls the purge back too.
import type { Db } from '../../../db/types.js';
import type { PluginRoute } from '../../../plugins/types.js';
import { Repository } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';
import { broadcast } from '../../../realtime.js';
import { dispatchWebhooks } from '../../../webhooks.js';
import { META, T } from '../meta.js';
import { serializeHost } from '../serialize.js';

type Row = Record<string, unknown>;
const ident = (name: string): string => '`' + name.replace(/`/g, '``') + '`';

/**
 * Purge a host's discovered resources in dependency order. Containers go first:
 * deleting them cascades their child rows (mounts/network_settings), releasing the
 * ON DELETE RESTRICT references that would otherwise block deleting volumes and
 * networks. Images follow once no container references them. Registries are kept.
 */
async function purgeHostResources(tx: Db, hostId: number): Promise<void> {
  for (const table of [T.container, T.image, T.volume, T.network]) {
    await tx.execute(`DELETE FROM ${ident(table)} WHERE host_id = ?`, [hostId]);
  }
}

export const hostWriteRoutes: PluginRoute[] = (['PUT', 'PATCH'] as const).map(
  (method): PluginRoute => ({
    method,
    path: `${META.host.endpoint}{id}/`,
    handler: async ({ db, params, body }) => {
      const id = Number(params.id);
      const repo = new Repository<Row>(db, getTable(T.host)!);
      if (!(await repo.retrieve(id))) return { status: 404, body: { detail: 'Not found' } };

      const data: Row = { ...((body ?? {}) as Row) };
      // Asking the host to refresh resets its view: mark it "refreshing" and clear
      // the resources it discovered, both before storing the change.
      const refreshing = data.operation === 'refresh';
      await db.transaction(async (tx) => {
        if (refreshing) {
          data.state = 'refreshing';
          await purgeHostResources(tx, id);
        }
        await new Repository<Row>(tx, getTable(T.host)!).update(id, data);
      });

      const out = await serializeHost(db, (await repo.retrieve(id))!);
      broadcast({
        type: 'change',
        event: 'updated',
        object_type: META.host.objectType,
        table: T.host,
        id,
        data: out,
      });
      void dispatchWebhooks(db, META.host, 'updated', id, out);
      return { status: 200, body: out };
    },
  }),
);
