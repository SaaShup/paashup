import mysql from 'mysql2/promise';
import type { Db, ExecResult, Param } from './types.js';

export interface MariaDbConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
  socketPath?: string;
  connectionLimit?: number;
}

type Conn = mysql.Pool | mysql.PoolConnection;

function mapParams(params: readonly Param[]): unknown[] {
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

/** Shared query logic against either a pool or a single (transaction) connection. */
class MariaDbConn implements Db {
  readonly dialect = 'mariadb' as const;
  constructor(protected readonly conn: Conn) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly Param[] = [],
  ): Promise<T[]> {
    const [rows] = await this.conn.query(sql, mapParams(params));
    return rows as T[];
  }

  async get<T = Record<string, unknown>>(
    sql: string,
    params: readonly Param[] = [],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async execute(sql: string, params: readonly Param[] = []): Promise<ExecResult> {
    const [res] = await this.conn.query(sql, mapParams(params));
    const r = res as mysql.ResultSetHeader;
    return { insertId: Number(r.insertId ?? 0), affectedRows: Number(r.affectedRows ?? 0) };
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    // Overridden by the pool-backed MariaDb; a single connection can't nest.
    return fn(this);
  }

  async close(): Promise<void> {
    /* pool connections are released, not closed, here */
  }
}

export class MariaDb extends MariaDbConn {
  private readonly pool: mysql.Pool;

  constructor(config: MariaDbConfig) {
    const pool = mysql.createPool({
      host: config.host ?? '127.0.0.1',
      port: config.port ?? 3306,
      user: config.user ?? 'root',
      password: config.password ?? '',
      database: config.database,
      socketPath: config.socketPath,
      connectionLimit: config.connectionLimit ?? 10,
      dateStrings: true, // return DATETIME as ISO-ish strings, matching SQLite
      decimalNumbers: true, // return DECIMAL as number, matching SQLite
      supportBigNumbers: true,
    });
    super(pool);
    this.pool = pool;
  }

  override async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx = new MariaDbConn(conn);
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  override async close(): Promise<void> {
    await this.pool.end();
  }

  /** Best-effort connection-pool stats for the metrics gauge (mysql2 internals). */
  poolStats(): { total: number; idle: number } {
    const core = (this.pool as unknown as { pool?: Record<string, unknown> }).pool;
    const len = (v: unknown): number => {
      const o = v as { length?: number; toArray?: () => unknown[] } | undefined;
      return o?.length ?? o?.toArray?.().length ?? 0;
    };
    return { total: len(core?._allConnections), idle: len(core?._freeConnections) };
  }
}
