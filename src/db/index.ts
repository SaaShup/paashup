import type { Db } from './types.js';
import { SqliteDb } from './sqlite.js';
import { MariaDb, type MariaDbConfig } from './mariadb.js';

export type { Db, Dialect, ExecResult, Param } from './types.js';
export { SqliteDb } from './sqlite.js';
export { MariaDb, type MariaDbConfig } from './mariadb.js';

export type DbConfig =
  | { dialect: 'sqlite'; filename: string }
  | ({ dialect: 'mariadb' } & MariaDbConfig);

/** Build a Db from config — SQLite for small customers, MariaDB for big ones. */
export function createDb(config: DbConfig): Db {
  if (config.dialect === 'sqlite') return new SqliteDb(config.filename);
  return new MariaDb(config);
}
