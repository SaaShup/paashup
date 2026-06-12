// Self-service API-key management on top of the existing `auth_token` table (see
// migration 0002 and src/auth.ts). Keys are per-user: a key is owned by its creator
// and authenticates as that user via `Authorization: Token <key>`. The full key is
// returned only once (on create); every other read is masked.
import type { Db } from './db/types.js';
import { createToken } from './auth.js';

const TABLE = 'auth_token';

/** Mask a key for display, keeping the last 4 chars so users can tell keys apart. */
export function maskKey(key: string): string {
  return key.length <= 4 ? '•'.repeat(key.length) : '•'.repeat(key.length - 4) + key.slice(-4);
}

/** A token as returned to its owner — never includes the real key. */
export interface MaskedToken {
  id: number;
  description: string;
  write_enabled: boolean;
  expires: string | null;
  created: string | null;
  last_used: string | null;
  /** Masked key, e.g. "••••…a1b2". */
  key: string;
  /** Last 4 chars of the real key, for identification. */
  last4: string;
}

interface TokenRow {
  id: number;
  key: string;
  description: string;
  write_enabled: number;
  expires: string | null;
  created: string | null;
  last_used: string | null;
}

function toMasked(r: TokenRow): MaskedToken {
  return {
    id: Number(r.id),
    description: r.description,
    write_enabled: !!r.write_enabled,
    expires: r.expires,
    created: r.created,
    last_used: r.last_used,
    key: maskKey(r.key),
    last4: r.key.slice(-4),
  };
}

const SELECT = `id, \`key\`, description, write_enabled, expires, created, last_used`;

/** List a user's API keys (masked), newest first. */
export async function listUserTokens(db: Db, userId: number): Promise<MaskedToken[]> {
  const rows = await db.query<TokenRow>(
    `SELECT ${SELECT} FROM ${TABLE} WHERE user_id = ? ORDER BY id DESC`,
    [userId],
  );
  return rows.map(toMasked);
}

export interface CreateUserTokenInput {
  description?: string;
  /** ISO timestamp; null/undefined = never expires. */
  expires?: string | null;
  /** Default true (read-write). Set false for a read-only key. */
  writeEnabled?: boolean;
}

/**
 * Create an API key for `userId` and return it INCLUDING the full `key` — this is the
 * only time the plaintext key is exposed. Subsequent reads go through listUserTokens.
 */
export async function createUserToken(
  db: Db,
  userId: number,
  input: CreateUserTokenInput,
): Promise<MaskedToken & { key: string }> {
  const { id, key } = await createToken(db, {
    userId,
    writeEnabled: input.writeEnabled !== false,
    expires: input.expires ?? null,
    description: input.description ?? '',
  });
  const row = await db.get<TokenRow>(`SELECT ${SELECT} FROM ${TABLE} WHERE id = ?`, [id]);
  // Replace the masked key with the real one (shown once).
  return { ...toMasked(row!), key, last4: key.slice(-4) };
}

/** Revoke (delete) one of the user's own keys. Returns false if it isn't theirs. */
export async function revokeUserToken(db: Db, userId: number, id: number): Promise<boolean> {
  const res = await db.execute(`DELETE FROM ${TABLE} WHERE id = ? AND user_id = ?`, [id, userId]);
  return res.affectedRows > 0;
}
