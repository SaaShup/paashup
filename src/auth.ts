import crypto from 'node:crypto';
import type { Db } from './db/types.js';

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
export async function createToken(db: Db, input: CreateTokenInput): Promise<{ id: number; key: string }> {
  const key = input.key ?? generateTokenKey();
  const res = await db.execute(
    'INSERT INTO auth_token (`key`, user_id, write_enabled, expires, description) VALUES (?, ?, ?, ?, ?)',
    [key, input.userId, input.writeEnabled === false ? 0 : 1, input.expires ?? null, input.description ?? ''],
  );
  return { id: res.insertId, key };
}

/** Resolve an `Authorization: Token <key>` header to an auth context, or null. */
export async function authenticate(db: Db, header: string | undefined): Promise<AuthContext | null> {
  if (!header) return null;
  const m = /^Token\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const row = await db.get<{ id: number; userId: number; writeEnabled: number; expires: string | null }>(
    'SELECT id, user_id AS userId, write_enabled AS writeEnabled, expires FROM auth_token WHERE `key` = ?',
    [m[1]!.trim()],
  );
  if (!row) return null;
  if (row.expires && new Date(row.expires).getTime() < Date.now()) return null;
  return { tokenId: Number(row.id), userId: Number(row.userId), writeEnabled: !!row.writeEnabled };
}
