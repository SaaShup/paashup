/**
 * Business logic for Keycloak integration.
 * Orchestrates database operations and Keycloak Admin API calls.
 *
 * Local tables mirror Keycloak (server → realm → client → redirect_url).
 * Realm/client writes are REAL: creating or deleting them here creates or
 * deletes them in Keycloak. Reads re-sync the mirror (additively for
 * realms/clients, exactly for redirect URLs).
 */

import type { Db } from '../../db/types.js';
import { ValidationError } from '../../errors.js';
import { KeycloakAdminClient } from './keycloak-api.js';
import type {
  KeycloakServerRow,
  KeycloakRealmRow,
  KeycloakClientRow,
  KeycloakRedirectUrlRow,
  FetchRealmsResult,
  AddRedirectUrlResult,
  RemoveRedirectUrlResult,
  RedirectUrlKind,
  SyncUrlsInput,
  SyncUrlsResult,
} from './keycloak-types.js';
import { T } from './keycloak-meta.js';

/** Clients every Keycloak realm ships with — never interesting for redirect URLs. */
const BUILTIN_CLIENTS = new Set([
  'account',
  'account-console',
  'admin-cli',
  'broker',
  'realm-management',
  'security-admin-console',
]);

/** Build an admin client from a stored server row. */
function adminClient(server: KeycloakServerRow): KeycloakAdminClient {
  return new KeycloakAdminClient({
    url: server.url,
    adminUsername: server.admin_username,
    adminPassword: server.admin_password,
  });
}

// ============================================================================
// Server operations
// ============================================================================

/**
 * Get a server by ID from database.
 */
export async function getServerById(db: Db, serverId: number): Promise<KeycloakServerRow> {
  const server = await db.get<KeycloakServerRow>(
    `SELECT id, name, url, admin_username, admin_password, created_at, updated_at
     FROM ${T.server} WHERE id = ?`,
    [serverId],
  );

  if (!server) {
    throw new ValidationError('Server not found', { id: ['Unknown server ID.'] });
  }

  return server;
}

/**
 * Create a new Keycloak server configuration.
 */
export async function createServer(
  db: Db,
  name: string,
  url: string,
  adminUsername: string,
  adminPassword: string,
): Promise<KeycloakServerRow> {
  // Test connection first
  const client = new KeycloakAdminClient({
    url,
    adminUsername,
    adminPassword,
  });

  try {
    await client.testConnection();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ValidationError('Connection failed', {
      url: [`Failed to connect to Keycloak: ${message}`],
    });
  }

  // Insert into database (timestamps come from the column defaults — portable
  // across SQLite and MariaDB)
  const result = await db.execute(
    `INSERT INTO ${T.server} (name, url, admin_username, admin_password)
     VALUES (?, ?, ?, ?)`,
    [name, url, adminUsername, adminPassword],
  );

  return getServerById(db, result.insertId as number);
}

/**
 * Delete a server and all associated realms/clients/URLs (local mirror only —
 * nothing is removed in Keycloak).
 */
export async function deleteServer(db: Db, serverId: number): Promise<void> {
  const exists = await db.get(`SELECT id FROM ${T.server} WHERE id = ?`, [serverId]);

  if (!exists) {
    throw new ValidationError('Server not found', { id: ['Unknown server ID.'] });
  }

  await db.execute(`DELETE FROM ${T.server} WHERE id = ?`, [serverId]);
}

// ============================================================================
// Realm operations (writes are REAL — they hit Keycloak)
// ============================================================================

/**
 * Get a realm by ID.
 */
export async function getRealmById(db: Db, realmId: number): Promise<KeycloakRealmRow> {
  const realm = await db.get<KeycloakRealmRow>(
    `SELECT id, server_id, realm_name FROM ${T.realm} WHERE id = ?`,
    [realmId],
  );

  if (!realm) {
    throw new ValidationError('Realm not found', { id: ['Unknown realm ID.'] });
  }

  return realm;
}

/**
 * Fetch realm names from a Keycloak server (no local writes).
 */
export async function fetchRealmsFromServer(db: Db, serverId: number): Promise<FetchRealmsResult> {
  const server = await getServerById(db, serverId);
  const client = adminClient(server);

  try {
    const realms = await client.listRealms();
    return { realms, error: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { realms: [], error: message };
  }
}

/**
 * Create a realm in Keycloak, then mirror it locally.
 */
export async function createRealm(
  db: Db,
  serverId: number,
  realmName: string,
): Promise<KeycloakRealmRow> {
  const server = await getServerById(db, serverId);

  try {
    await adminClient(server).createRealm(realmName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ValidationError('Keycloak realm creation failed', { name: [message] });
  }

  const result = await db.execute(`INSERT INTO ${T.realm} (server_id, realm_name) VALUES (?, ?)`, [
    serverId,
    realmName,
  ]);
  console.log(`[Keycloak] Created realm ${realmName} on server ${server.name}`);

  return getRealmById(db, result.insertId as number);
}

/**
 * Rename a realm in Keycloak, then locally.
 */
export async function renameRealm(
  db: Db,
  realmId: number,
  newName: string,
): Promise<KeycloakRealmRow> {
  const realm = await getRealmById(db, realmId);
  if (newName === realm.realm_name) return realm;

  const server = await getServerById(db, realm.server_id);

  try {
    await adminClient(server).renameRealm(realm.realm_name, newName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ValidationError('Keycloak realm rename failed', { name: [message] });
  }

  await db.execute(`UPDATE ${T.realm} SET realm_name = ? WHERE id = ?`, [newName, realmId]);
  console.log(`[Keycloak] Renamed realm ${realm.realm_name} -> ${newName}`);

  return getRealmById(db, realmId);
}

/**
 * Delete a realm in Keycloak AND locally (clients/URLs cascade).
 */
export async function deleteRealm(db: Db, realmId: number): Promise<void> {
  const realm = await getRealmById(db, realmId);
  const server = await getServerById(db, realm.server_id);

  try {
    await adminClient(server).deleteRealm(realm.realm_name);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ValidationError('Keycloak realm deletion failed', { id: [message] });
  }

  await db.execute(`DELETE FROM ${T.realm} WHERE id = ?`, [realmId]);
  console.log(`[Keycloak] Deleted realm ${realm.realm_name}`);
}

// ============================================================================
// Client operations (writes are REAL — they hit Keycloak)
// ============================================================================

/**
 * Get a client row by ID.
 */
export async function getClientRowById(db: Db, clientRowId: number): Promise<KeycloakClientRow> {
  const row = await db.get<KeycloakClientRow>(
    `SELECT id, realm_id, client_id, kc_uuid, secret FROM ${T.client} WHERE id = ?`,
    [clientRowId],
  );

  if (!row) {
    throw new ValidationError('Client not found', { id: ['Unknown client ID.'] });
  }

  return row;
}

/** A client row with its realm and server — everything a Keycloak call needs. */
interface ClientContext {
  row: KeycloakClientRow;
  realm: KeycloakRealmRow;
  server: KeycloakServerRow;
  kc: KeycloakAdminClient;
}

async function clientContext(db: Db, clientRowId: number): Promise<ClientContext> {
  const row = await getClientRowById(db, clientRowId);
  const realm = await getRealmById(db, row.realm_id);
  const server = await getServerById(db, realm.server_id);
  return { row, realm, server, kc: adminClient(server) };
}

/** Resolve the client's Keycloak uuid (stored, or looked up by clientId). */
async function kcUuidOf(db: Db, ctx: ClientContext): Promise<string> {
  if (ctx.row.kc_uuid) return ctx.row.kc_uuid;
  const rep = await ctx.kc.getClient(ctx.realm.realm_name, ctx.row.client_id);
  await db.execute(`UPDATE ${T.client} SET kc_uuid = ? WHERE id = ?`, [rep.id, ctx.row.id]);
  return rep.id;
}

/**
 * Create a confidential OIDC client (Authorization Code flow) in Keycloak,
 * fetch its generated secret, and mirror both locally.
 */
export async function createClient(
  db: Db,
  realmId: number,
  clientIdName: string,
): Promise<KeycloakClientRow> {
  const realm = await getRealmById(db, realmId);
  const server = await getServerById(db, realm.server_id);
  const kc = adminClient(server);

  let uuid: string;
  let secret: string | null = null;
  try {
    const rep = await kc.createClient(realm.realm_name, clientIdName);
    uuid = rep.id;
    secret = await kc.getClientSecret(realm.realm_name, uuid).catch(() => null);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ValidationError('Keycloak client creation failed', { name: [message] });
  }

  const result = await db.execute(
    `INSERT INTO ${T.client} (realm_id, client_id, kc_uuid, secret) VALUES (?, ?, ?, ?)`,
    [realmId, clientIdName, uuid, secret],
  );
  console.log(`[Keycloak] Created client ${realm.realm_name}/${clientIdName}`);

  return getClientRowById(db, result.insertId as number);
}

/**
 * Rename a client (its clientId) in Keycloak, then locally.
 */
export async function renameClient(
  db: Db,
  clientRowId: number,
  newName: string,
): Promise<KeycloakClientRow> {
  const ctx = await clientContext(db, clientRowId);
  if (newName === ctx.row.client_id) return ctx.row;

  try {
    const uuid = await kcUuidOf(db, ctx);
    await ctx.kc.renameClient(ctx.realm.realm_name, uuid, newName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ValidationError('Keycloak client rename failed', { name: [message] });
  }

  await db.execute(`UPDATE ${T.client} SET client_id = ? WHERE id = ?`, [newName, clientRowId]);
  console.log(`[Keycloak] Renamed client ${ctx.row.client_id} -> ${newName}`);

  return getClientRowById(db, clientRowId);
}

/**
 * Delete a client in Keycloak AND locally (URLs cascade).
 */
export async function deleteClient(db: Db, clientRowId: number): Promise<void> {
  const ctx = await clientContext(db, clientRowId);

  try {
    const uuid = await kcUuidOf(db, ctx);
    await ctx.kc.deleteClient(ctx.realm.realm_name, uuid);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new ValidationError('Keycloak client deletion failed', { id: [message] });
  }

  await db.execute(`DELETE FROM ${T.client} WHERE id = ?`, [clientRowId]);
  console.log(`[Keycloak] Deleted client ${ctx.realm.realm_name}/${ctx.row.client_id}`);
}

/**
 * Ask Keycloak for a fresh secret and store it. Returns the new secret.
 */
export async function regenerateClientSecret(db: Db, clientRowId: number): Promise<string | null> {
  const ctx = await clientContext(db, clientRowId);
  const uuid = await kcUuidOf(db, ctx);
  const secret = await ctx.kc.regenerateClientSecret(ctx.realm.realm_name, uuid);
  await db.execute(`UPDATE ${T.client} SET secret = ? WHERE id = ?`, [secret, clientRowId]);
  console.log(`[Keycloak] Regenerated secret for ${ctx.realm.realm_name}/${ctx.row.client_id}`);
  return secret;
}

// ============================================================================
// Discovery & sync (Keycloak → local mirror)
// ============================================================================

/**
 * Discover realms and clients from a server: every realm (except master) gets
 * a local row, every non-built-in client too (with its secret when readable),
 * and each new client's redirect URLs are imported. Additive and idempotent —
 * locally-known rows are left untouched. Returns what was added.
 */
export async function autoDiscoverRealms(db: Db, serverId: number): Promise<string[]> {
  const server = await getServerById(db, serverId);
  const kc = adminClient(server);

  const realms = await kc.listRealms();
  const added: string[] = [];

  for (const realmName of realms) {
    try {
      if (realmName === 'master') continue; // built-in admin realm

      // Upsert the realm row
      let realmRow = await db.get<{ id: number }>(
        `SELECT id FROM ${T.realm} WHERE server_id = ? AND realm_name = ?`,
        [serverId, realmName],
      );
      if (!realmRow) {
        const r = await db.execute(`INSERT INTO ${T.realm} (server_id, realm_name) VALUES (?, ?)`, [
          serverId,
          realmName,
        ]);
        realmRow = { id: r.insertId as number };
        added.push(realmName);
        console.log(`[Keycloak] Discovered realm: ${realmName}`);
      }

      // Upsert one client row per non-built-in client
      const clients = (await kc.listClients(realmName)).filter(
        (c) => c.clientId && !BUILTIN_CLIENTS.has(c.clientId),
      );
      for (const rep of clients) {
        const existing = await db.get(
          `SELECT id FROM ${T.client} WHERE realm_id = ? AND client_id = ?`,
          [realmRow.id, rep.clientId],
        );
        if (existing) continue;

        // Secret is only readable for confidential clients — best effort
        const secret = rep.publicClient
          ? null
          : await kc.getClientSecret(realmName, rep.id).catch(() => null);

        const c = await db.execute(
          `INSERT INTO ${T.client} (realm_id, client_id, kc_uuid, secret) VALUES (?, ?, ?, ?)`,
          [realmRow.id, rep.clientId, rep.id, secret],
        );
        added.push(`${realmName}/${rep.clientId}`);
        console.log(`[Keycloak] Discovered client: ${realmName}/${rep.clientId}`);

        const n = await importRedirectUrls(db, c.insertId as number);
        if (n)
          console.log(`[Keycloak] Imported ${n} redirect URLs for ${realmName}/${rep.clientId}`);
      }
    } catch (err) {
      console.error(`[Keycloak] Failed to discover realm "${realmName}":`, err);
    }
  }

  return added;
}

/**
 * Re-sync realms and clients from every configured server. Failures are
 * logged and swallowed so the read path keeps serving local data when
 * Keycloak is down.
 */
export async function syncAllServers(db: Db): Promise<void> {
  const servers = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM ${T.server}`,
    [],
  );

  for (const server of servers) {
    try {
      await autoDiscoverRealms(db, server.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Keycloak] Sync failed for server "${server.name}": ${message}`);
    }
  }
}

/**
 * Mirror a client's URIs from Keycloak into the local table — both kinds:
 * 'callback' (redirectUris) and 'post_logout' (the
 * `post.logout.redirect.uris` client attribute). Missing URIs are inserted,
 * URIs removed in Keycloak are dropped. Idempotent. Returns the number of
 * URIs seen in Keycloak.
 */
export async function importRedirectUrls(db: Db, clientRowId: number): Promise<number> {
  const ctx = await clientContext(db, clientRowId);
  const uris = await ctx.kc.getUris(ctx.realm.realm_name, ctx.row.client_id);

  for (const kind of ['callback', 'post_logout'] as const) {
    const wanted = uris[kind];

    // Insert URIs we don't have yet (portable — no INSERT OR IGNORE in MariaDB)
    const existing = new Set(
      (
        await db.query<{ url: string }>(
          `SELECT url FROM ${T.redirectUrl} WHERE client_id = ? AND kind = ?`,
          [clientRowId, kind],
        )
      ).map((r) => r.url),
    );
    for (const uri of wanted) {
      if (existing.has(uri)) continue;
      await db.execute(`INSERT INTO ${T.redirectUrl} (client_id, url, kind) VALUES (?, ?, ?)`, [
        clientRowId,
        uri,
        kind,
      ]);
    }

    // Drop local rows whose URI no longer exists in Keycloak
    if (wanted.length) {
      const placeholders = wanted.map(() => '?').join(', ');
      await db.execute(
        `DELETE FROM ${T.redirectUrl}
         WHERE client_id = ? AND kind = ? AND url NOT IN (${placeholders})`,
        [clientRowId, kind, ...wanted],
      );
    } else {
      await db.execute(`DELETE FROM ${T.redirectUrl} WHERE client_id = ? AND kind = ?`, [
        clientRowId,
        kind,
      ]);
    }
  }

  return uris.callback.length + uris.post_logout.length;
}

/**
 * Re-sync redirect URLs from Keycloak — one client, or every known client.
 * Same failure policy as syncAllServers.
 */
export async function syncRedirectUrls(db: Db, clientRowId?: number): Promise<void> {
  const clients = clientRowId
    ? [{ id: clientRowId }]
    : await db.query<{ id: number }>(`SELECT id FROM ${T.client}`, []);

  for (const client of clients) {
    try {
      await importRedirectUrls(db, client.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Keycloak] Redirect URL sync failed for client ${client.id}: ${message}`);
    }
  }
}

// ============================================================================
// Redirect URL operations
// ============================================================================

/**
 * Get a redirect URL by ID.
 */
export async function getRedirectUrlById(db: Db, urlId: number): Promise<KeycloakRedirectUrlRow> {
  const url = await db.get<KeycloakRedirectUrlRow>(
    `SELECT id, client_id, url, kind, created_at
     FROM ${T.redirectUrl} WHERE id = ?`,
    [urlId],
  );

  if (!url) {
    throw new ValidationError('URL not found', { id: ['Unknown URL ID.'] });
  }

  return url;
}

/**
 * Push one URI of the given kind to a client in Keycloak.
 */
async function pushUriToKeycloak(
  ctx: ClientContext,
  url: string,
  kind: RedirectUrlKind,
): Promise<void> {
  if (kind === 'post_logout') {
    await ctx.kc.addPostLogoutUri(ctx.realm.realm_name, ctx.row.client_id, url);
  } else {
    await ctx.kc.addRedirectUri(ctx.realm.realm_name, ctx.row.client_id, url);
  }
}

/**
 * Upsert the local mirror row for a URI (no-op when already mirrored).
 */
async function upsertUrlRow(
  db: Db,
  clientRowId: number,
  url: string,
  kind: RedirectUrlKind,
): Promise<void> {
  const exists = await db.get<{ id: number }>(
    `SELECT id FROM ${T.redirectUrl} WHERE client_id = ? AND url = ? AND kind = ?`,
    [clientRowId, url, kind],
  );
  if (exists) return;
  await db.execute(`INSERT INTO ${T.redirectUrl} (client_id, url, kind) VALUES (?, ?, ?)`, [
    clientRowId,
    url,
    kind,
  ]);
}

/**
 * Add a redirect URL to a client in Keycloak (manual path, from the UI).
 */
export async function addRedirectUrl(
  db: Db,
  clientRowId: number,
  redirectUrl: string,
  kind: RedirectUrlKind = 'callback',
): Promise<AddRedirectUrlResult> {
  try {
    const ctx = await clientContext(db, clientRowId);
    await pushUriToKeycloak(ctx, redirectUrl, kind);
    await upsertUrlRow(db, clientRowId, redirectUrl, kind);

    return {
      success: true,
      message: `Added ${kind} URL: ${redirectUrl}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      success: false,
      message: `Failed to add ${kind} URL: ${message}`,
    };
  }
}

/**
 * Remove a redirect URL from a client in Keycloak.
 */
export async function removeRedirectUrl(db: Db, urlId: number): Promise<RemoveRedirectUrlResult> {
  const urlRow = await getRedirectUrlById(db, urlId);

  try {
    const ctx = await clientContext(db, urlRow.client_id);

    // Remove from Keycloak (branch on which URI list the row mirrors)
    if (urlRow.kind === 'post_logout') {
      await ctx.kc.removePostLogoutUri(ctx.realm.realm_name, ctx.row.client_id, urlRow.url);
    } else {
      await ctx.kc.removeRedirectUri(ctx.realm.realm_name, ctx.row.client_id, urlRow.url);
    }

    // Delete from database
    await db.execute(`DELETE FROM ${T.redirectUrl} WHERE id = ?`, [urlId]);

    return {
      success: true,
      message: `Removed ${urlRow.kind} URL: ${urlRow.url}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      success: false,
      message: `Failed to remove ${urlRow.kind} URL: ${message}`,
    };
  }
}

/**
 * Get a client's current URIs straight from Keycloak (both kinds).
 */
export async function getRedirectUrisFromKeycloak(
  db: Db,
  clientRowId: number,
): Promise<{ callback: string[]; post_logout: string[] }> {
  const ctx = await clientContext(db, clientRowId);
  return ctx.kc.getUris(ctx.realm.realm_name, ctx.row.client_id);
}

// ============================================================================
// Instance URL registration (driven by the orchestrator, e.g. nbdiu)
// ============================================================================

/** Instance URLs are always registered as https. */
const SCHEME = 'https';

/** Ensure a path joins cleanly onto the base URL. */
function normalizePath(path: string): string {
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

/** Normalize a caller-supplied base URL: default scheme, no trailing slash. */
function normalizeBaseUrl(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `${SCHEME}://${url}`;
  return withScheme.replace(/\/+$/, '');
}

/** The two URLs an instance registers, computed deterministically from the input. */
function instanceUrls(input: SyncUrlsInput): { url: string; kind: RedirectUrlKind }[] {
  const base = normalizeBaseUrl(input.url);
  return [
    { url: `${base}${normalizePath(input.callback_path)}`, kind: 'callback' },
    { url: `${base}${normalizePath(input.postlogout_path ?? '')}`, kind: 'post_logout' },
  ];
}

/** The client rows an input targets (empty when not configured in paashup). */
async function targetClients(db: Db, input: SyncUrlsInput): Promise<number[]> {
  const rows = await db.query<{ id: number }>(
    `SELECT c.id FROM ${T.client} c
     JOIN ${T.realm} r ON r.id = c.realm_id
     WHERE r.realm_name = ? AND c.client_id = ?`,
    [input.realm, input.client_id],
  );
  return rows.map((r) => r.id);
}

/**
 * Register an instance's URLs in Keycloak: the callback URL in the client's
 * redirect URIs, and a post-logout URL (postlogout_path, or the bare base
 * URL). Everything comes from the request — paashup needs no knowledge of
 * the instance. Idempotent: re-running never duplicates.
 */
export async function registerInstanceUrls(db: Db, input: SyncUrlsInput): Promise<SyncUrlsResult> {
  const result: SyncUrlsResult = { urls: [], errors: [] };

  const clientRowIds = await targetClients(db, input);
  if (!clientRowIds.length) {
    result.skipped = `realm "${input.realm}" with client "${input.client_id}" is not configured in paashup`;
    console.warn(`[Keycloak] register-urls: ${result.skipped}`);
    return result;
  }

  for (const clientRowId of clientRowIds) {
    const ctx = await clientContext(db, clientRowId);
    for (const { url, kind } of instanceUrls(input)) {
      try {
        await pushUriToKeycloak(ctx, url, kind);
        await upsertUrlRow(db, clientRowId, url, kind);
        result.urls.push({ url, kind, realm: ctx.realm.realm_name, client_id: ctx.row.client_id });
        console.log(
          `[Keycloak] Registered ${kind} URL ${url} on ${ctx.realm.realm_name}/${ctx.row.client_id}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${kind} ${url}: ${message}`);
        console.error(`[Keycloak] Failed to register ${kind} URL ${url}: ${message}`);
      }
    }
  }

  return result;
}

/**
 * Remove an instance's URLs from Keycloak and the local mirror. The URLs are
 * recomputed from the input, so the caller must send the same values it
 * registered with. A local row is dropped only when the Keycloak removal
 * succeeded, so a transient failure can be retried.
 */
export async function unregisterInstanceUrls(
  db: Db,
  input: SyncUrlsInput,
): Promise<SyncUrlsResult> {
  const result: SyncUrlsResult = { urls: [], errors: [] };

  const clientRowIds = await targetClients(db, input);
  if (!clientRowIds.length) {
    result.skipped = `realm "${input.realm}" with client "${input.client_id}" is not configured in paashup`;
    console.warn(`[Keycloak] unregister-urls: ${result.skipped}`);
    return result;
  }

  for (const clientRowId of clientRowIds) {
    const ctx = await clientContext(db, clientRowId);
    for (const { url, kind } of instanceUrls(input)) {
      try {
        if (kind === 'post_logout') {
          await ctx.kc.removePostLogoutUri(ctx.realm.realm_name, ctx.row.client_id, url);
        } else {
          await ctx.kc.removeRedirectUri(ctx.realm.realm_name, ctx.row.client_id, url);
        }
        await db.execute(
          `DELETE FROM ${T.redirectUrl} WHERE client_id = ? AND url = ? AND kind = ?`,
          [clientRowId, url, kind],
        );
        result.urls.push({ url, kind, realm: ctx.realm.realm_name, client_id: ctx.row.client_id });
        console.log(
          `[Keycloak] Unregistered ${kind} URL ${url} from ${ctx.realm.realm_name}/${ctx.row.client_id}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`${kind} ${url}: ${message}`);
        console.error(`[Keycloak] Failed to unregister ${kind} URL ${url}: ${message}`);
      }
    }
  }

  return result;
}
