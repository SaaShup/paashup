import { DatabaseSync } from 'node:sqlite';
import type { Db, ExecResult, Param } from './types.js';

/** node:sqlite accepts null | number | bigint | string | Uint8Array. */
function bind(params: readonly Param[]): (string | number | bigint | null | Uint8Array)[] {
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p === undefined) return null;
    return p as string | number | bigint | null | Uint8Array;
  });
}

export class SqliteDb implements Db {
  readonly dialect = 'sqlite' as const;
  private readonly db: DatabaseSync;
  private inTx = false;
  /** Number of statements executed — useful for spotting N+1 in tests. */
  queries = 0;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
  }

  /** Run raw SQL (e.g. a migration script). */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly Param[] = []): Promise<T[]> {
    this.queries++;
    return this.db.prepare(sql).all(...bind(params)) as T[];
  }

  async get<T = Record<string, unknown>>(sql: string, params: readonly Param[] = []): Promise<T | undefined> {
    this.queries++;
    return this.db.prepare(sql).get(...bind(params)) as T | undefined;
  }

  async execute(sql: string, params: readonly Param[] = []): Promise<ExecResult> {
    this.queries++;
    const r = this.db.prepare(sql).run(...bind(params));
    return { insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) };
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this); // flatten nested transactions
    this.db.exec('BEGIN');
    this.inTx = true;
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.inTx = false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
