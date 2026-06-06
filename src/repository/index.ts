import type { Db } from '../db/types.js';
import { type TableName } from '../model/metadata.js';
import { getTable } from '../model/registry.js';
import type { TableTypeMap } from '../model/types.js';
import { Repository } from './repository.js';

export { Repository } from './repository.js';
export type { ListOptions, Page } from './repository.js';

/**
 * Get a fully-typed repository for a core table:
 *
 *   const devices = repository(db, 'dcim_device');
 *   const page = await devices.list({ filters: { status: 'active' } });
 *   const d = await devices.create({ name: 'sw1', device_type: 1, role: 1, site: 1, status: 'active' });
 *
 * For plugin-registered tables (not in the generated `TableName`), construct a
 * `new Repository(db, getTable(name)!)` directly.
 */
export function repository<K extends TableName>(
  db: Db,
  table: K,
): Repository<TableTypeMap[K]['row'], TableTypeMap[K]['create'], TableTypeMap[K]['update']> {
  const meta = getTable(table);
  if (!meta) throw new Error(`Unknown table "${table}"`);
  return new Repository(db, meta);
}

export { tables, type TableName } from '../model/metadata.js';
