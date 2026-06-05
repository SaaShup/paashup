import type { Db } from '../db/types.js';
import { tables, type TableName } from '../model/metadata.js';
import type { TableMeta } from '../model/meta-types.js';
import type { TableTypeMap } from '../model/types.js';
import { Repository } from './repository.js';

export { Repository } from './repository.js';
export type { ListOptions, Page } from './repository.js';

/**
 * Get a fully-typed repository for a table:
 *
 *   const devices = repository(db, 'dcim_device');
 *   const page = await devices.list({ filters: { status: 'active' } });
 *   const d = await devices.create({ name: 'sw1', device_type: 1, role: 1, site: 1, status: 'active' });
 */
export function repository<K extends TableName>(
  db: Db,
  table: K,
): Repository<TableTypeMap[K]['row'], TableTypeMap[K]['create'], TableTypeMap[K]['update']> {
  // `as TableMeta` widens the narrow literal type that `satisfies` preserves.
  return new Repository(db, tables[table] as TableMeta);
}

export { tables, type TableName } from '../model/metadata.js';
