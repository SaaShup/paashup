// Minimal NetBox-compatible journal entries (/api/extras/journal-entries/). The
// Docker agent (and other NetBox clients) POST journal entries after operations;
// this registers a permissive entity so those writes succeed. Table is created by
// migration 0008. Registered at import — server.ts imports this module for the side effect.
import type { TableMeta } from './model/meta-types.js';
import { registerEntity } from './model/registry.js';

export const JOURNAL_TABLE = 'extras_journalentry';

const col = (
  name: string,
  tsKind: 'string' | 'number',
  writable = true,
): TableMeta['columns'][number] => ({
  name,
  column: name,
  tsKind,
  nullable: true,
  writable,
  required: false,
});

const journalMeta: TableMeta = {
  model: 'JournalEntry',
  table: JOURNAL_TABLE,
  section: 'extras',
  endpoint: '/api/extras/journal-entries/',
  origin: 'core',
  pk: 'id',
  pkKind: 'number',
  objectType: 'extras.journalentry',
  readOnly: false,
  relations: [],
  counts: [],
  columns: [
    col('assigned_object_type', 'string'),
    col('assigned_object_id', 'number'),
    col('kind', 'string'),
    col('comments', 'string'),
    col('created', 'string', false),
    col('last_updated', 'string', false),
  ],
};

registerEntity(journalMeta);
