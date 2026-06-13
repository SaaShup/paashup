import crypto from 'node:crypto';
import type { Db } from './db/types.js';
import { oidcEnabled, verifyOidcToken, rolesFromClaims, type OidcClaims } from './oidc.js';

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
    const row = await db.get<{
      id: number;
      userId: number;
      writeEnabled: number;
      expires: string | null;
    }>(
      'SELECT id, user_id AS userId, write_enabled AS writeEnabled, expires FROM auth_token WHERE `key` = ?',
      [tok[1]!.trim()],
    );
    if (!row) return null;
    if (row.expires && new Date(row.expires).getTime() < Date.now()) return null;
    // Record usage (best-effort; never block the request on it).
    try {
      await db.execute('UPDATE auth_token SET last_used = ? WHERE id = ?', [
        new Date().toISOString(),
        Number(row.id),
      ]);
    } catch {
      /* last_used is advisory — ignore failures */
    }
    return {
      tokenId: Number(row.id),
      userId: Number(row.userId),
      writeEnabled: !!row.writeEnabled,
    };
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearer && oidcEnabled()) {
    const claims = await verifyOidcToken(bearer[1]!.trim());
    if (!claims) return null;
    return contextFromOidc(db, claims);
  }
  return null;
}

/** Map verified OIDC claims to a local user (find-or-create) + write permission. */
async function contextFromOidc(db: Db, claims: OidcClaims): Promise<AuthContext | null> {
  const usernameClaim = process.env.PB_OIDC_USERNAME_CLAIM || 'preferred_username';
  const username = String(claims[usernameClaim] ?? claims.sub ?? '').trim();
  if (!username) return null;
  const userId = await findOrCreateUser(db, username, claims);
  const writeRole = process.env.PB_OIDC_WRITE_ROLE;
  // No role configured ⇒ any authenticated SSO user may write; else require the role.
  const writeEnabled = !writeRole || rolesFromClaims(claims).includes(writeRole);
  return { tokenId: 0, userId, writeEnabled };
}

async function findOrCreateUser(db: Db, username: string, claims: OidcClaims): Promise<number> {
  const row = await db.get<{ id: number }>('SELECT id FROM users_user WHERE username = ?', [
    username,
  ]);
  if (row) return Number(row.id);
  const res = await db.execute(
    `INSERT INTO users_user (username, email, first_name, last_name, is_active, date_joined)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [
      username,
      String(claims.email ?? ''),
      String(claims.given_name ?? ''),
      String(claims.family_name ?? ''),
      new Date().toISOString(),
    ],
  );
  return res.insertId;
}
