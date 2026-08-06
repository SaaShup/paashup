// Host write routes. Hosts mostly ride generic CRUD, but three things need custom
// handling that the generic path can't express:
//  - POST: mint a static API token for the host's agent and attach it, so the
//    "[Docker] Add host" webhook can transmit it. The token is included only in the
//    create response/webhook (never on plain reads). Also seeds the default registry.
//  - PUT/PATCH: a refresh (operation="refresh") marks the host "refreshing" and purges
//    its discovered resources (containers/images/volumes/networks) before storing.
//  - DELETE: revoke the host's token so it can't outlive the host.
import type { Db } from '../../../db/types.js';
import type { PluginRoute } from '../../../plugins/types.js';
import { Repository } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';
import { fireHooks } from '../../../plugins/runtime.js';
import { broadcast } from '../../../realtime.js';
import { dispatchWebhooks } from '../../../webhooks.js';
import { createToken } from '../../../auth.js';
import { applyOriginDefaults } from '../../../api/origin.js';
import { META, T } from '../meta.js';
import { serializeHost } from '../serialize.js';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;
const ident = (name: string): string => '`' + name.replace(/`/g, '``') + '`';

/** Username that owns auto-minted host tokens (a non-interactive service account). */
const SERVICE_USER = process.env.PB_DOCKER_AGENT_USER || 'docker-agent';

/** Emit a host change to the realtime feed and any configured webhooks. */
function emitHost(db: Db, event: 'created' | 'updated' | 'deleted', id: number, data: Obj): void {
  broadcast({ type: 'change', event, object_type: META.host.objectType, table: T.host, id, data });
  void dispatchWebhooks(db, META.host, event, id, data);
}

/** Find or create the service user that owns host tokens. Null if users aren't available. */
async function serviceUserId(db: Db): Promise<number | null> {
  try {
    const row = await db.get<{ id: number }>('SELECT id FROM users_user WHERE username = ?', [
      SERVICE_USER,
    ]);
    if (row) return Number(row.id);
    const res = await db.execute(
      `INSERT INTO users_user (username, email, first_name, last_name, is_active, date_joined)
       VALUES (?, '', '', '', 1, ?)`,
      [SERVICE_USER, new Date().toISOString()],
    );
    return res.insertId;
  } catch {
    return null; // users table unavailable
  }
}

/**
 * Mint a static, write-enabled API token for the host's agent and attach it (token_id).
 * Best-effort: on a minimal deploy without the auth_token/users tables the host is
 * simply created without a token.
 */
async function attachHostToken(db: Db, hostId: number, name: string): Promise<void> {
  const userId = await serviceUserId(db);
  if (userId == null) return;
  try {
    const { id } = await createToken(db, {
      userId,
      writeEnabled: true,
      description: `Docker host: ${name}`,
    });
    await db.execute(`UPDATE ${ident(T.host)} SET token_id = ? WHERE id = ?`, [id, hostId]);
  } catch {
    /* auth_token table absent → host has no token */
  }
}

/** Create one host: persist it, mint+attach its agent token, seed the default registry. */
async function createOneHost(db: Db, body: Row, origin: string): Promise<Obj> {
  const meta = getTable(T.host)!;
  applyOriginDefaults(meta, body, origin); // default netbox_base_url from the request (issue #33)
  const repo = new Repository<Row>(db, meta);
  const created = await repo.create(body);
  const id = Number((created as { id: number }).id);
  await attachHostToken(db, id, String((created as { name?: unknown }).name ?? ''));
  await fireHooks(db, T.host, 'created', id, created); // seeds the default "dockerhub" registry
  const out = await serializeHost(db, (await repo.retrieve(id))!, { withToken: true });
  emitHost(db, 'created', id, out);
  return out;
}

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

const createRoute: PluginRoute = {
  method: 'POST',
  path: META.host.endpoint,
  handler: async ({ db, body, origin }) => {
    if (Array.isArray(body)) {
      const out: Obj[] = [];
      for (const item of body) out.push(await createOneHost(db, (item ?? {}) as Row, origin));
      return { status: 201, body: out };
    }
    return { status: 201, body: await createOneHost(db, (body ?? {}) as Row, origin) };
  },
};

const updateRoutes: PluginRoute[] = (['PUT', 'PATCH'] as const).map((method): PluginRoute => ({
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
    emitHost(db, 'updated', id, out);
    return { status: 200, body: out };
  },
}));

const deleteRoute: PluginRoute = {
  method: 'DELETE',
  path: `${META.host.endpoint}{id}/`,
  handler: async ({ db, params }) => {
    const id = Number(params.id);
    const repo = new Repository<Row>(db, getTable(T.host)!);
    const existing = await repo.retrieve(id);
    if (!existing) return { status: 404, body: { detail: 'Not found' } };
    // token_id isn't a serialized column — read it directly so we can revoke it.
    const tok = await db.get<{ token_id: number | null }>(
      `SELECT token_id FROM ${ident(T.host)} WHERE id = ?`,
      [id],
    );
    const prechange = await serializeHost(db, existing); // for the "[Docker] Delete host" webhook
    await repo.destroy(id);
    if (tok?.token_id) {
      try {
        await db.execute('DELETE FROM auth_token WHERE id = ?', [tok.token_id]);
      } catch {
        /* auth_token table absent → nothing to revoke */
      }
    }
    await fireHooks(db, T.host, 'deleted', id);
    emitHost(db, 'deleted', id, prechange);
    return { status: 204 };
  },
};

export const hostWriteRoutes: PluginRoute[] = [createRoute, ...updateRoutes, deleteRoute];
