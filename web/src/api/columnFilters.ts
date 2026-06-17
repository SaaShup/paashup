// Per-column filter options for the resource list table. For each writable field of a
// model we build the set of selectable values, keyed by field name (which matches the
// table column name and the server's `?<field>=<value>` filter):
//   - fk      -> every row of the related model (value = id, label = display)
//   - select  -> the field's enum choices
//   - text /
//     number  -> the distinct values present in the data (a single capped scan)
// boolean/json/multiselect/iplist are intentionally skipped: they aren't usefully
// filterable as a single exact value (and the server does not coerce booleans).
import { api, type Obj } from './client.js';
import { formFields, modelEndpoints } from './schema.js';

export interface FilterOption {
  value: string;
  label: string;
}
export type FilterOptions = Record<string, FilterOption[]>;

const SCAN_LIMIT = 1000; // cap the distinct-value scan for free-text / number columns

const cache = new Map<string, Promise<FilterOptions>>();

/** Build (and cache per model+endpoint) the per-field filter option lists. */
export function buildFilterOptions(model: string, endpoint: string): Promise<FilterOptions> {
  const key = `${model}|${endpoint}`;
  let p = cache.get(key);
  if (!p) {
    p = compute(model, endpoint);
    cache.set(key, p);
  }
  return p;
}

/** Drop cached options (e.g. after data changes), so they rebuild on next view. */
export function clearFilterOptionsCache(): void {
  cache.clear();
}

async function compute(model: string, endpoint: string): Promise<FilterOptions> {
  const out: FilterOptions = {};
  const fields = await formFields(model);
  const eps = await modelEndpoints();

  // text/number distinct values need a single (capped) scan of the resource
  const hasScalar = fields.some((f) => f.kind === 'text' || f.kind === 'number');
  let rows: Obj[] = [];
  if (hasScalar) {
    try {
      rows = (await api.list(endpoint, { limit: SCAN_LIMIT })).results;
    } catch {
      rows = [];
    }
  }

  await Promise.all(
    fields.map(async (f) => {
      if (f.kind === 'fk' && f.targetModel && eps[f.targetModel]) {
        try {
          const page = await api.list(eps[f.targetModel], { limit: SCAN_LIMIT });
          out[f.name] = page.results
            .map((o) => ({
              value: String((o as { id: number }).id),
              label: String((o as { display?: unknown }).display ?? (o as { id: number }).id),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
        } catch {
          /* FK options are best-effort */
        }
      } else if (f.kind === 'select' && f.choices?.length) {
        out[f.name] = f.choices.map((c) => ({ value: String(c), label: String(c) }));
      } else if ((f.kind === 'text' || f.kind === 'number') && rows.length) {
        const seen = new Set<string>();
        for (const r of rows) {
          const v = (r as Record<string, unknown>)[f.name];
          if (v === null || v === undefined || v === '') continue;
          seen.add(String(v));
        }
        if (seen.size) {
          out[f.name] = [...seen]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map((v) => ({ value: v, label: v }));
        }
      }
    }),
  );
  return out;
}
