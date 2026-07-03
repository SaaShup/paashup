import crypto from 'node:crypto';
import type { Db } from './db/types.js';
import { oidcEnabled, verifyBearer, authorizeIdentity, exchangeCode, getProvider } from './oidc.js';
import { recordAuth, recordLogin } from './metrics.js';

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

/** Name of the HttpOnly browser-session cookie carrying a paas2box token. */
export const SESSION_COOKIE = 'pb_session';

/** Validate a raw token key → auth context. Shared by the `Token` header and the
 *  browser session cookie. Updates `last_used` best-effort. */
async function authByToken(db: Db, key: string): Promise<AuthContext | null> {
  const row = await db.get<{
    id: number;
    userId: number;
    writeEnabled: number;
    expires: string | null;
  }>(
    'SELECT id, user_id AS userId, write_enabled AS writeEnabled, expires FROM auth_token WHERE `key` = ?',
    [key],
  );
  if (!row) return null;
  if (row.expires && new Date(row.expires).getTime() < Date.now()) return null;
  try {
    await db.execute('UPDATE auth_token SET last_used = ? WHERE id = ?', [
      new Date().toISOString(),
      Number(row.id),
    ]);
  } catch {
    /* last_used is advisory — ignore failures */
  }
  return { tokenId: Number(row.id), userId: Number(row.userId), writeEnabled: !!row.writeEnabled };
}

/** Read the `pb_session` token from a Cookie header, or null. */
export function tokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Set-Cookie value that establishes the browser session (HttpOnly, SameSite=Lax so
 *  it rides top-level navigations — the whole point of issue #36). */
export function sessionCookieHeader(
  token: string,
  opts: { secure: boolean; maxAgeSec?: number },
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAgeSec != null) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`);
  return parts.join('; ');
}

/** Set-Cookie value that clears the browser session (logout). */
export function clearSessionCookieHeader(opts: { secure: boolean }): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Resolve a request's credentials to an auth context, or null. In order: a static API
 * token (`Authorization: Token <key>`); an OIDC bearer JWT (`Authorization: Bearer
 * <jwt>`, when OIDC is configured); else the `pb_session` browser cookie (same paas2box
 * token, HttpOnly) — so a logged-in user can open API URLs directly in the browser
 * (links, address bar, bookmarks) without a 403 (issue #36).
 */
export async function authenticate(
  db: Db,
  header: string | undefined,
  cookieHeader?: string | undefined,
): Promise<AuthContext | null> {
  const trimmed = header?.trim();
  if (trimmed) {
    const tok = /^Token\s+(.+)$/i.exec(trimmed);
    if (tok) {
      const ctx = await authByToken(db, tok[1]!.trim());
      recordAuth('token', !!ctx);
      return ctx;
    }

    // Machine-to-machine: a Keycloak (or other) service-account JWT presented directly.
    // The provider is selected by the token's issuer; opaque tokens (e.g. Google access
    // tokens) aren't JWTs and are rejected here — interactive users go through the
    // BFF exchange (ssoExchange) and then use the resulting paas2box token.
    const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
    if (bearer && oidcEnabled()) {
      const v = await verifyBearer(bearer[1]!.trim());
      if (!v) {
        recordAuth('oidc', false);
        return null;
      }
      const id = authorizeIdentity(v.provider, v.claims);
      if ('error' in id) {
        recordAuth('oidc', false);
        return null;
      }
      const userId = await findOrCreateUser(db, id.username, id);
      recordAuth('oidc', true);
      return { tokenId: 0, userId, writeEnabled: id.writeEnabled };
    }
    return null; // a malformed Authorization header is not a cookie fallback case
  }

  const cookieKey = tokenFromCookie(cookieHeader);
  if (cookieKey) {
    const ctx = await authByToken(db, cookieKey);
    recordAuth('token', !!ctx); // session cookie carries a token key
    return ctx;
  }
  return null;
}

interface UserProfile {
  email?: string;
  firstName?: string;
  lastName?: string;
}

async function findOrCreateUser(db: Db, username: string, p: UserProfile = {}): Promise<number> {
  const row = await db.get<{ id: number }>('SELECT id FROM users_user WHERE username = ?', [
    username,
  ]);
  if (row) return Number(row.id);
  const res = await db.execute(
    `INSERT INTO users_user (username, email, first_name, last_name, is_active, date_joined)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [username, p.email ?? '', p.firstName ?? '', p.lastName ?? '', new Date().toISOString()],
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
  if (!provider) {
    recordLogin('unknown', false);
    return { error: `unknown provider "${providerId}"`, status: 400 };
  }
  const r = await exchangeCode(provider, args);
  if ('error' in r) {
    recordLogin(provider.id, false);
    return r;
  }
  const { identity } = r;
  recordLogin(provider.id, true);
  const userId = await findOrCreateUser(db, identity.username, identity);
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
