/**
 * HTTP routes for Keycloak plugin.
 * Short, readable handlers that delegate to services.
 *
 * All reads go through the engine `Repository` so DB columns are aliased to
 * their logical names (`server_id` → `server`) — that is what lets the engine
 * `Serializer` expand foreign keys into nested briefs ({id, url, display}),
 * exactly like the Docker plugin. Detail responses embed their children
 * (server → realms, realm → clients, client → redirect_urls).
 *
 * Realm and client writes are REAL: they create/rename/delete in Keycloak.
 */

import type { Db } from '../../db/types.js';
import type { PluginRoute } from '../../plugins/types.js';
import { Repository } from '../../repository/repository.js';
import { Serializer, type Serialized } from '../../api/serializer.js';
import { broadcast } from '../../realtime.js';
import { dispatchWebhooks } from '../../webhooks.js';
import { getTable } from '../../model/registry.js';
import { META, T } from './keycloak-meta.js';
import * as service from './keycloak-service.js';
import type { SyncUrlsInput } from './keycloak-types.js';

type RequestBody = Record<string, unknown>;
type Row = Record<string, unknown>;

const base = (): string => process.env.BASE_URL ?? '';
const ser = (db: Db): Serializer => new Serializer(db, base());
const repo = (db: Db, table: string): Repository<Row> => new Repository<Row>(db, getTable(table)!);

/** Serialize one row (a fresh read of it) for a response. */
async function serializeOne(db: Db, table: string, id: number): Promise<Serialized | null> {
  const row = await repo(db, table).retrieve(id);
  return row ? ser(db).object(table, row) : null;
}

/** List + serialize rows of `table`, optionally filtered by one FK value. */
async function serializeList(
  db: Db,
  table: string,
  fkField?: string,
  fkValue?: number,
): Promise<Serialized[]> {
  const { results } = await repo(db, table).list({
    filters: fkField && fkValue ? { [fkField]: fkValue } : {},
    ordering: 'id',
    limit: 1000,
  });
  return ser(db).objects(table, results);
}

/** Read a positive-int query param under any of the given names. */
function intParam(query: URLSearchParams, ...names: string[]): number | undefined {
  for (const n of names) {
    const raw = query.get(n);
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isInteger(v) && v > 0) return v;
    }
  }
  return undefined;
}

/** First non-empty string among body fields (generic form vs legacy API names). */
function str(body: RequestBody, ...names: string[]): string {
  for (const n of names) {
    const v = body[n];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

/** First numeric value among body fields; FKs may arrive as `{id}` briefs. */
function num(body: RequestBody, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = body[n];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v && !isNaN(Number(v))) return Number(v);
    if (v && typeof v === 'object' && 'id' in v) return Number((v as { id: unknown }).id);
  }
  return undefined;
}

/**
 * Emit change events for realtime updates and webhooks.
 */
function emitChange(
  db: Db,
  event: 'created' | 'updated' | 'deleted',
  modelName: keyof typeof META,
  id: number,
  data?: RequestBody,
): void {
  const meta = META[modelName];
  broadcast({
    type: 'change',
    event,
    object_type: meta.objectType,
    table: meta.table,
    id,
    data,
  });
  void dispatchWebhooks(db, meta, event, id, data);
}

// ============================================================================
// Server routes
// ============================================================================

const serverRoutes: PluginRoute[] = [
  {
    method: 'GET',
    path: META.server.endpoint,
    handler: async ({ db }) => {
      const results = await serializeList(db, T.server);
      return { status: 200, body: { results, count: results.length } };
    },
  },
  {
    method: 'POST',
    path: META.server.endpoint,
    handler: async ({ db, body }) => {
      const input = (body ?? {}) as RequestBody;

      const server = await service.createServer(
        db,
        str(input, 'name'),
        str(input, 'server_url', 'url'),
        str(input, 'admin_username'),
        str(input, 'admin_password'),
      );

      // Auto-discover realms and clients from the server
      const discovered = await service.autoDiscoverRealms(db, server.id);
      console.log(
        `[Keycloak] Server "${server.name}" created. Discovered: ${discovered.join(', ') || 'nothing'}.`,
      );

      const serialized = await serializeOne(db, T.server, server.id);
      emitChange(db, 'created', 'server', server.id, serialized as RequestBody);

      return { status: 201, body: { ...serialized, discovered } };
    },
  },
  {
    method: 'GET',
    path: `${META.server.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const serverId = Number(params.id);
      const serialized = await serializeOne(db, T.server, serverId);
      if (!serialized) return { status: 404, body: { detail: 'Not found.' } };
      // Embed the server's realms, like Docker embeds a host's containers.
      serialized.realms = await serializeList(db, T.realm, 'server', serverId);
      return { status: 200, body: serialized };
    },
  },
  {
    method: 'DELETE',
    path: `${META.server.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const serverId = Number(params.id);
      await service.deleteServer(db, serverId);
      emitChange(db, 'deleted', 'server', serverId);
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    path: `${META.server.endpoint}{id}/sync-realms/`,
    handler: async ({ db, params }) => {
      const serverId = Number(params.id);
      const result = await service.fetchRealmsFromServer(db, serverId);

      if (result.error) {
        return { status: 500, body: { error: result.error } };
      }

      return { status: 200, body: { realms: result.realms } };
    },
  },
];

// ============================================================================
// Realm routes (create/rename/delete are REAL Keycloak writes)
// ============================================================================

const realmRoutes: PluginRoute[] = [
  {
    method: 'GET',
    path: META.realm.endpoint,
    handler: async ({ db, query }) => {
      // Re-sync from Keycloak on every read so new realms/clients show up
      // without re-adding the server (failures fall back to local data).
      await service.syncAllServers(db);

      // `?server=` comes from the UI's filtered navigation, `?server_id=` from the API
      const serverId = intParam(query, 'server', 'server_id');
      const results = await serializeList(db, T.realm, 'server', serverId);
      return { status: 200, body: { results, count: results.length } };
    },
  },
  {
    method: 'POST',
    path: META.realm.endpoint,
    handler: async ({ db, body }) => {
      const input = (body ?? {}) as RequestBody;

      const realm = await service.createRealm(
        db,
        num(input, 'server', 'server_id') ?? 0,
        str(input, 'name', 'realm_name'),
      );

      const serialized = await serializeOne(db, T.realm, realm.id);
      emitChange(db, 'created', 'realm', realm.id, serialized as RequestBody);

      return { status: 201, body: serialized };
    },
  },
  {
    method: 'GET',
    path: `${META.realm.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const realmId = Number(params.id);
      const serialized = await serializeOne(db, T.realm, realmId);
      if (!serialized) return { status: 404, body: { detail: 'Not found.' } };
      // Embed the realm's clients
      serialized.clients = await serializeList(db, T.client, 'realm', realmId);
      return { status: 200, body: serialized };
    },
  },
  {
    method: 'PATCH',
    path: `${META.realm.endpoint}{id}/`,
    handler: async ({ db, params, body }) => {
      const realmId = Number(params.id);
      const newName = str((body ?? {}) as RequestBody, 'name', 'realm_name');
      if (!newName) return { status: 400, body: { error: '"name" is required' } };

      const realm = await service.renameRealm(db, realmId, newName);

      const out = await serializeOne(db, T.realm, realm.id);
      emitChange(db, 'updated', 'realm', realmId, out as RequestBody);
      return { status: 200, body: out };
    },
  },
  {
    method: 'DELETE',
    path: `${META.realm.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const realmId = Number(params.id);
      await service.deleteRealm(db, realmId); // deletes in Keycloak too
      emitChange(db, 'deleted', 'realm', realmId);
      return { status: 204 };
    },
  },
];

// ============================================================================
// Client routes (create/rename/delete are REAL Keycloak writes)
// ============================================================================

const clientRoutes: PluginRoute[] = [
  {
    method: 'GET',
    path: META.client.endpoint,
    handler: async ({ db, query }) => {
      const realmId = intParam(query, 'realm', 'realm_id');
      const results = await serializeList(db, T.client, 'realm', realmId);
      return { status: 200, body: { results, count: results.length } };
    },
  },
  {
    method: 'POST',
    path: META.client.endpoint,
    handler: async ({ db, body }) => {
      const input = (body ?? {}) as RequestBody;
      const realmId = num(input, 'realm', 'realm_id') ?? 0;
      const name = str(input, 'name', 'client_id');
      if (!name) return { status: 400, body: { error: '"name" is required' } };

      // Creates a confidential OIDC client (Authorization Code flow) in
      // Keycloak; its generated secret is fetched and stored.
      const client = await service.createClient(db, realmId, name);

      const serialized = await serializeOne(db, T.client, client.id);
      emitChange(db, 'created', 'client', client.id, serialized as RequestBody);

      return { status: 201, body: serialized };
    },
  },
  {
    method: 'GET',
    path: `${META.client.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const clientId = Number(params.id);
      const serialized = await serializeOne(db, T.client, clientId);
      if (!serialized) return { status: 404, body: { detail: 'Not found.' } };
      // Embed the client's redirect URLs
      serialized.redirect_urls = await serializeList(db, T.redirectUrl, 'client', clientId);
      return { status: 200, body: serialized };
    },
  },
  {
    method: 'PATCH',
    path: `${META.client.endpoint}{id}/`,
    handler: async ({ db, params, body }) => {
      const clientId = Number(params.id);
      const newName = str((body ?? {}) as RequestBody, 'name', 'client_id');
      if (!newName) return { status: 400, body: { error: '"name" is required' } };

      const client = await service.renameClient(db, clientId, newName);

      const out = await serializeOne(db, T.client, client.id);
      emitChange(db, 'updated', 'client', clientId, out as RequestBody);
      return { status: 200, body: out };
    },
  },
  {
    method: 'DELETE',
    path: `${META.client.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const clientId = Number(params.id);
      await service.deleteClient(db, clientId); // deletes in Keycloak too
      emitChange(db, 'deleted', 'client', clientId);
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    path: `${META.client.endpoint}{id}/regenerate-secret/`,
    handler: async ({ db, params }) => {
      const clientId = Number(params.id);
      const secret = await service.regenerateClientSecret(db, clientId);
      const out = await serializeOne(db, T.client, clientId);
      emitChange(db, 'updated', 'client', clientId, out as RequestBody);
      return { status: 200, body: { secret } };
    },
  },
];

// ============================================================================
// Redirect URL routes
// ============================================================================

const redirectUrlRoutes: PluginRoute[] = [
  {
    method: 'GET',
    path: META.redirectUrl.endpoint,
    handler: async ({ db, query }) => {
      // `?client=` comes from the UI's filtered navigation, `?client_id=` from the API
      const clientId = intParam(query, 'client', 'client_id');

      // Mirror Keycloak on every read: new/removed URIs show up without any
      // manual action (failures fall back to local data).
      await service.syncRedirectUrls(db, clientId);

      const results = await serializeList(db, T.redirectUrl, 'client', clientId);
      return { status: 200, body: { results, count: results.length } };
    },
  },
  {
    method: 'POST',
    path: META.redirectUrl.endpoint,
    handler: async ({ db, body }) => {
      const input = (body ?? {}) as RequestBody;
      const clientId = num(input, 'client') ?? 0;
      const url = str(input, 'name', 'url');
      // the enum arrives plain from the API but as {value,label} from the UI form
      const kindRaw = input.kind;
      const kind =
        (typeof kindRaw === 'object' && kindRaw !== null
          ? String((kindRaw as { value?: unknown }).value ?? '')
          : String(kindRaw ?? '')) === 'post_logout'
          ? ('post_logout' as const)
          : ('callback' as const);

      const result = await service.addRedirectUrl(db, clientId, url, kind);

      if (!result.success) {
        return { status: 502, body: { error: result.message } };
      }

      // Fetch the created row for the response
      const created = await db.get<{ id: number }>(
        `SELECT id FROM ${T.redirectUrl} WHERE client_id = ? AND url = ? AND kind = ?`,
        [clientId, url, kind],
      );

      if (!created) {
        return { status: 500, body: { error: 'URL created but not found' } };
      }

      const serialized = await serializeOne(db, T.redirectUrl, created.id);
      emitChange(db, 'created', 'redirectUrl', created.id, serialized as RequestBody);

      return { status: 201, body: serialized };
    },
  },
  {
    method: 'DELETE',
    path: `${META.redirectUrl.endpoint}{id}/`,
    handler: async ({ db, params }) => {
      const urlId = Number(params.id);
      const result = await service.removeRedirectUrl(db, urlId);

      if (!result.success) {
        return { status: 502, body: { error: result.message } };
      }

      emitChange(db, 'deleted', 'redirectUrl', urlId);
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    path: `${META.redirectUrl.endpoint}from-keycloak/`,
    handler: async ({ db, query }) => {
      const clientId = intParam(query, 'client', 'client_id');

      if (!clientId) {
        return { status: 400, body: { error: 'client query parameter is required' } };
      }

      try {
        const uris = await service.getRedirectUrisFromKeycloak(db, clientId);
        return {
          status: 200,
          body: { redirect_uris: uris.callback, post_logout_uris: uris.post_logout },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { status: 502, body: { error: `Failed to fetch from Keycloak: ${message}` } };
      }
    },
  },
];

// ============================================================================
// Instance sync routes — called by the orchestrator (e.g. nbdiu) after it
// creates an instance and before it deletes one. Both are idempotent, and
// self-contained: everything needed is in the body, paasbox has no knowledge
// of the instance. Unregister must receive the same values as register (the
// URLs are recomputed from them).
// ============================================================================

/** Parse + validate the sync body; returns an error message when incomplete. */
function syncInput(body: RequestBody): { input?: SyncUrlsInput; error?: string } {
  const input = {
    url: str(body, 'url', 'base_url'),
    realm: str(body, 'realm'),
    client_id: str(body, 'client_id', 'client'),
    callback_path: str(body, 'callback_path'),
    postlogout_path: str(body, 'postlogout_path') || undefined,
  };
  const missing = (['url', 'realm', 'client_id', 'callback_path'] as const).filter(
    (f) => !input[f],
  );
  if (missing.length) return { error: `Missing required field(s): ${missing.join(', ')}` };
  return { input };
}

/** 200 when work was done or skipped; 502 when every attempted write failed. */
function syncResponse(result: { urls: unknown[]; errors: string[]; skipped?: string }): {
  status: number;
  body: RequestBody;
} {
  const failed = result.errors.length > 0 && result.urls.length === 0;
  return { status: failed ? 502 : 200, body: result as unknown as RequestBody };
}

const instanceSyncRoutes: PluginRoute[] = [
  {
    method: 'POST',
    path: '/api/plugins/keycloak/redirect-urls/register/',
    handler: async ({ db, body }) => {
      const { input, error } = syncInput((body ?? {}) as RequestBody);
      if (!input) return { status: 400, body: { error } };
      return syncResponse(await service.registerInstanceUrls(db, input));
    },
  },
  {
    method: 'POST',
    path: '/api/plugins/keycloak/redirect-urls/unregister/',
    handler: async ({ db, body }) => {
      const { input, error } = syncInput((body ?? {}) as RequestBody);
      if (!input) return { status: 400, body: { error } };
      return syncResponse(await service.unregisterInstanceUrls(db, input));
    },
  },
];

// ============================================================================
// Exports
// ============================================================================

export const keycloakRoutes: PluginRoute[] = [
  ...serverRoutes,
  ...realmRoutes,
  ...clientRoutes,
  ...redirectUrlRoutes,
  ...instanceSyncRoutes,
];
