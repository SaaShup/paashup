import type { Db } from './types.js';
import { SqliteDb } from './sqlite.js';
import { MariaDb, type MariaDbConfig } from './mariadb.js';
import { recordDbOp, registerPoolGauge } from '../metrics.js';

export type { Db, Dialect, ExecResult, Param } from './types.js';
export { SqliteDb } from './sqlite.js';
export { MariaDb, type MariaDbConfig } from './mariadb.js';

export type DbConfig =
  { dialect: 'sqlite'; filename: string } | ({ dialect: 'mariadb' } & MariaDbConfig);

/**
 * Wrap a Db so query/get/execute (and transaction-scoped ops) record duration + failures
 * to the metrics registry. Other methods (exec, close, …) pass straight through.
 */
type DbFn = (...a: unknown[]) => Promise<unknown>;

function instrument(inner: Db, database: string): Db {
  const timed =
    (fn: DbFn, op: 'query' | 'execute') =>
    async (...args: unknown[]): Promise<unknown> => {
      const t = process.hrtime.bigint();
      try {
        const r = await fn.apply(inner, args);
        recordDbOp(database, op, Number(process.hrtime.bigint() - t) / 1e9, true);
        return r;
      } catch (e) {
        recordDbOp(database, op, Number(process.hrtime.bigint() - t) / 1e9, false);
        throw e;
      }
    };
  return new Proxy(inner, {
    get(target, prop, recv) {
      if (prop === 'query') return timed(target.query as unknown as DbFn, 'query');
      if (prop === 'get') return timed(target.get as unknown as DbFn, 'query');
      if (prop === 'execute') return timed(target.execute as unknown as DbFn, 'execute');
      if (prop === 'transaction')
        return (fn: (tx: Db) => Promise<unknown>) =>
          target.transaction((tx) => fn(instrument(tx, database)));
      const v = Reflect.get(target, prop, recv);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as Db;
}

/** Build a Db from config — SQLite for small customers, MariaDB for big ones. */
export function createDb(config: DbConfig): Db {
  if (config.dialect === 'sqlite') return instrument(new SqliteDb(config.filename), 'sqlite');
  const md = new MariaDb(config);
  registerPoolGauge('mariadb', () => md.poolStats());
  return instrument(md, 'mariadb');
}
