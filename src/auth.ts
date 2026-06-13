import crypto from 'node:crypto';
import type { Db } from './db/types.js';
import {
  oidcEnabled,
  verifyBearer,
  authorizeIdentity,
  exchangeCode,
  getProvider,
  type SsoIdentity,
} from './oidc.js';

export interface AuthContext {
  tokenId: number;
  userId: number;
  writeEnabled: boolean;
}

export interface AuthOptions {
  /** Reject unauthenticated requests with 403 (NetBox default for the API). */
  required?: boolean;
}

/** NetBox-style 40-hex token key. */
export function generateTokenKey(): string {
  return crypto.randomBytes(20).toString('hex');
}

export interface CreateTokenInput {
  userId: number;
  key?: string;
  writeEnabled?: boolean;
  expires?: string | null;
  description?: string;
}

/** Provision an API token for a user; returns the (only-shown-once) key. */
export async function createToken(
  db: Db,
  input: CreateTokenInput,
): Promise<{ id: number; key: string }> {
  const key = input.key ?? generateTokenKey();
  const res = await db.execute(
    'INSERT INTO auth_token (`key`, user_id, write_enabled, expires, description) VALUES (?, ?, ?, ?, ?)',
    [
      key,
      input.userId,
      input.writeEnabled === false ? 0 : 1,
      input.expires ?? null,
      input.description ?? '',
    ],
  );
  return { id: res.insertId, key };
}

export interface SeedTokenResult {
  /** true if a token was created now; false if one with that key already existed. */
  created: boolean;
  username: string;
  tokenId?: number;
}

/**
 * Bootstrap an API token from the environment, for deploy-time provisioning (so a
 * secure-by-default instance has a usable credential before any UI/OIDC login):
 *   PB_SEED_TOKEN           the token key to ensure exists (no-op if unset)
 *   PB_SEED_USERNAME        owning user, find-or-created (default "admin")
 *   PB_SEED_TOKEN_READONLY  "1" → read-only token (default: write-enabled)
 * Idempotent: if a token with that key already exists, nothing changes. Returns null
 * when PB_SEED_TOKEN is unset.
 */
export async function ensureSeedToken(db: Db): Promise<SeedTokenResult | null> {
  const key = process.env.PB_SEED_TOKEN?.trim();
  if (!key) return null;
  const username = (process.env.PB_SEED_USERNAME || 'admin').trim();

  const existing = await db.get<{ id: number }>('SELECT id FROM auth_token WHERE `key` = ?', [key]);
  if (existing) return { created: false, username };

  const user = await db.get<{ id: number }>('SELECT id FROM users_user WHERE username = ?', [
    username,
  ]);
  let userId: number;
  if (user) userId = Number(user.id);
  else {
    const res = await db.execute(
      `INSERT INTO users_user (username, email, first_name, last_name, is_active, date_joined)
       VALUES (?, '', '', '', 1, ?)`,
      [username, new Date().toISOString()],
    );
    userId = res.insertId;
  }

  const writeEnabled = process.env.PB_SEED_TOKEN_READONLY !== '1';
  const { id } = await createToken(db, {
    userId,
    key,
    writeEnabled,
    description: 'seeded at deploy time (PB_SEED_TOKEN)',
  });
  return { created: true, username, tokenId: id };
}

/**
 * Resolve an `Authorization` header to an auth context, or null. Supports both a
 * static API token (`Token <key>`) and — when OIDC is configured — a Keycloak/OIDC
 * bearer JWT (`Bearer <jwt>`), which is validated and mapped to a (auto-provisioned)
 * local user.
 */
export async function authenticate(
  db: Db,
  header: string | undefined,
): Promise<AuthContext | null> {
  if (!header) return null;
  const trimmed = header.trim();

  const tok = /^Token\s+(.+)$/i.exec(trimmed);
  if (tok) {
    // Join the owning user so a deactivated user's tokens stop working (is_active gate).
    const row = await db.get<{
      id: number;
      userId: number;
      writeEnabled: number;
      expires: string | null;
      lastUsed: string | null;
    }>(
      'SELECT t.id, t.user_id AS userId, t.write_enabled AS writeEnabled, t.expires, ' +
        't.last_used AS lastUsed FROM auth_token t JOIN users_user u ON u.id = t.user_id ' +
        'WHERE t.`key` = ? AND u.is_active = 1',
      [tok[1]!.trim()],
    );
    if (!row) return null;
    if (row.expires && new Date(row.expires).getTime() < Date.now()) return null;
    // Record usage — throttled to once a minute so we don't write on every request.
    const last = row.lastUsed ? Date.parse(row.lastUsed) : 0;
    if (Date.now() - last > 60_000) {
      try {
        await db.execute('UPDATE auth_token SET last_used = ? WHERE id = ?', [
          new Date().toISOString(),
          Number(row.id),
        ]);
      } catch {
        /* last_used is advisory — ignore failures */
      }
    }
    return {
      tokenId: Number(row.id),
      userId: Number(row.userId),
      writeEnabled: !!row.writeEnabled,
    };
  }

  // Machine-to-machine: a Keycloak (or other) service-account JWT presented directly.
  // The provider is selected by the token's issuer; opaque tokens (e.g. Google access
  // tokens) aren't JWTs and are rejected here — interactive users go through the
  // BFF exchange (ssoExchange) and then use the resulting paas2box token.
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearer && oidcEnabled()) {
    const v = await verifyBearer(bearer[1]!.trim());
    if (!v) return null;
    const id = authorizeIdentity(v.provider, v.claims);
    if ('error' in id) return null;
    const userId = await provisionOidcUser(db, id);
    // Reject if an admin has since deactivated this auto-provisioned user.
    const u = await db.get<{ is_active: number }>('SELECT is_active FROM users_user WHERE id = ?', [
      userId,
    ]);
    if (!u?.is_active) return null;
    return { tokenId: 0, userId, writeEnabled: id.writeEnabled };
  }
  return null;
}

/**
 * Provision (or find) the local user for a verified SSO identity, keyed on its stable
 * provider-namespaced `subject` — never on the display username. This prevents an OIDC
 * login (whose `preferred_username` is attacker-controllable) from attaching to a
 * pre-existing local user that shares that name, e.g. a seeded `admin`.
 */
async function provisionOidcUser(db: Db, id: SsoIdentity): Promise<number> {
  const existing = await db.get<{ id: number }>(
    'SELECT id FROM users_user WHERE oidc_subject = ?',
    [id.subject],
  );
  if (existing) return Number(existing.id);
  // Choose a username that doesn't collide with an existing row (local or another
  // subject); fall back to the unique subject so we never take over someone's username.
  let username = id.username;
  const clash = await db.get<{ id: number }>('SELECT id FROM users_user WHERE username = ?', [
    username,
  ]);
  if (clash) username = id.subject;
  const res = await db.execute(
    `INSERT INTO users_user (username, email, first_name, last_name, is_active, date_joined, oidc_subject)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [
      username,
      id.email ?? '',
      id.firstName ?? '',
      id.lastName ?? '',
      new Date().toISOString(),
      id.subject,
    ],
  );
  return res.insertId;
}

export interface SsoSession {
  token: string;
  tokenId: number;
  username: string;
  writeEnabled: boolean;
  expires: string;
}

/**
 * Backend-for-Frontend login: exchange an OIDC authorization `code` (sent by the SPA)
 * for tokens server-side, verify + authorize the identity, find-or-create the user, and
 * mint a paas2box session token the SPA then uses for all API/WS calls. Works uniformly
 * for any configured provider (Keycloak roles, Google domain/email) — see oidc.ts.
 */
export async function ssoExchange(
  db: Db,
  providerId: string,
  args: { code: string; codeVerifier?: string; redirectUri: string },
): Promise<SsoSession | { error: string; status: number }> {
  const provider = getProvider(providerId);
  if (!provider) return { error: `unknown provider "${providerId}"`, status: 400 };
  const r = await exchangeCode(provider, args);
  if ('error' in r) return r;
  const { identity } = r;
  const userId = await provisionOidcUser(db, identity);
  const ttlHours = Number(process.env.PB_OIDC_SESSION_TTL_HOURS ?? 12);
  const expires = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  const { id: tokenId, key } = await createToken(db, {
    userId,
    writeEnabled: identity.writeEnabled,
    expires,
    description: `sso:${provider.id}`,
  });
  return {
    token: key,
    tokenId,
    username: identity.username,
    writeEnabled: identity.writeEnabled,
    expires,
  };
}
