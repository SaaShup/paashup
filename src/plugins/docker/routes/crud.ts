// Shared GET list/detail handlers for the Docker entities. These override the
// engine's generic GET so responses carry the source's nested arrays; writes
// (POST/PATCH/DELETE) for the parent entities stay on the generic CRUD path so the
// engine still fires hooks + the realtime change-feed. Container writes are custom
// (see containers.ts) because they accept inline nested children.
import type { Db } from '../../../db/types.js';
import type { PluginRoute } from '../../../plugins/types.js';
import { Repository, type ListOptions } from '../../../repository/repository.js';
import { getTable } from '../../../model/registry.js';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;
export type SerializeFn = (db: Db, row: Row) => Promise<Obj>;

const base = (): string => process.env.BASE_URL ?? '';

/** Mirror of the server's query parser (limit/offset/ordering/q + field filters). */
export function parseListOptions(sp: URLSearchParams): ListOptions {
  const opts: ListOptions = { filters: {} };
  for (const key of new Set(sp.keys())) {
    const values = sp.getAll(key);
    if (key === 'limit') opts.limit = Number(values[0]);
    else if (key === 'offset') opts.offset = Number(values[0]);
    else if (key === 'ordering') opts.ordering = values[0];
    else if (key === 'q') opts.q = values[0];
    else if (key === 'format') continue;
    else opts.filters![key] = values.length > 1 ? values : values[0]!;
  }
  return opts;
}

function pageLink(endpoint: string, sp: URLSearchParams, offset: number, limit: number): string {
  const q = new URLSearchParams(sp);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return `${base()}${endpoint}?${q.toString()}`;
}

/** GET list + GET detail routes for `table`, serialized via `serialize`. */
export function readRoutes(table: string, endpoint: string, serialize: SerializeFn): PluginRoute[] {
  return [
    {
      method: 'GET',
      path: endpoint,
      handler: async ({ db, query }) => {
        const repo = new Repository<Row>(db, getTable(table)!);
        const page = await repo.list(parseListOptions(query));
        const results = await Promise.all(page.results.map((r) => serialize(db, r)));
        const next =
          page.offset + page.limit < page.count
            ? pageLink(endpoint, query, page.offset + page.limit, page.limit)
            : null;
        const previous =
          page.offset > 0
            ? pageLink(endpoint, query, Math.max(0, page.offset - page.limit), page.limit)
            : null;
        return { status: 200, body: { count: page.count, next, previous, results } };
      },
    },
    {
      method: 'GET',
      path: `${endpoint}{id}/`,
      handler: async ({ db, params }) => {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return { status: 404, body: { detail: 'Not found' } };
        const repo = new Repository<Row>(db, getTable(table)!);
        const row = await repo.retrieve(id);
        if (!row) return { status: 404, body: { detail: 'Not found' } };
        return { status: 200, body: await serialize(db, row as Row) };
      },
    },
  ];
}
