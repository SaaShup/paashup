// Minimal async database abstraction so one Repository works over both SQLite
// (node:sqlite, small customers) and MariaDB (mysql2, big customers). Both use
// `?` positional placeholders, so SQL strings are portable.

export type Dialect = 'sqlite' | 'mariadb';

export type Param = string | number | bigint | boolean | null | Uint8Array;

export interface ExecResult {
  /** Auto-increment id of the inserted row (0 if none). */
  readonly insertId: number;
  readonly affectedRows: number;
}

export interface Db {
  readonly dialect: Dialect;
  /** Run a SELECT and return all rows. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly Param[]): Promise<T[]>;
  /** Run a SELECT and return the first row (or undefined). */
  get<T = Record<string, unknown>>(sql: string, params?: readonly Param[]): Promise<T | undefined>;
  /** Run an INSERT/UPDATE/DELETE. */
  execute(sql: string, params?: readonly Param[]): Promise<ExecResult>;
  /** Run `fn` inside a transaction; commit on success, rollback on throw. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
