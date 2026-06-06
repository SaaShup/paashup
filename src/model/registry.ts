import type { TableMeta } from './meta-types.js';
import { tables as generated } from './metadata.js';

// Runtime table registry: seeded from the generated core metadata, extended at
// startup by plugins. Everything that routes/serializes consults this rather than
// the static `tables` const, so plugin entities behave exactly like core ones.
const reg = new Map<string, TableMeta>();
for (const [name, meta] of Object.entries(generated)) reg.set(name, meta as TableMeta);

let version = 0;

export function registerEntity(meta: TableMeta): void {
  if (reg.has(meta.table)) {
    throw new Error(`Table "${meta.table}" is already registered`);
  }
  reg.set(meta.table, meta);
  version++;
}

export function getTable(name: string): TableMeta | undefined {
  return reg.get(name);
}

export function allTables(): TableMeta[] {
  return [...reg.values()];
}

/** Bumped whenever an entity is registered, so caches can invalidate. */
export function registryVersion(): number {
  return version;
}
