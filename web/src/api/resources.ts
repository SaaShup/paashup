import { api } from './client.js';

/** A browsable resource discovered from the served OpenAPI schema. */
export interface Resource {
  /** Collection endpoint, e.g. "/api/dcim/devices/". */
  endpoint: string;
  /** Physical table name (matches WebSocket change events), e.g. "dcim_device". */
  table: string;
  /** App section, e.g. "dcim". */
  section: string;
  /** Human label, e.g. "Devices". */
  label: string;
  /** OpenAPI model name (e.g. "Device"); absent for read-only resources. */
  model?: string;
  /** Whether the resource supports create/update/delete. */
  writable: boolean;
  /** Creation-dependency rank (prerequisites first); lower = create earlier. */
  order: number;
}

function titleize(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A single foreign-key target model from a read-schema property, else null. */
function fkTarget(prop: any): string | null {
  const ref: string | undefined = prop?.$ref ?? prop?.allOf?.[0]?.$ref;
  if (typeof ref === 'string') {
    const name = ref.split('/').pop()!;
    if (name.endsWith('Brief')) return name.slice(0, -'Brief'.length);
  }
  return null; // arrays (M2M) and generic relations are not creation prerequisites
}

/**
 * Topologically order models by their foreign-key dependencies so prerequisites
 * come first (e.g. Region before Site). Self-references and cycles are tolerated.
 */
function dependencyOrder(doc: any, models: Set<string>): Map<string, number> {
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    const set = new Set<string>();
    const props = doc.components?.schemas?.[m]?.properties ?? {};
    for (const prop of Object.values<any>(props)) {
      const t = fkTarget(prop);
      if (t && t !== m && models.has(t)) set.add(t);
    }
    deps.set(m, set);
  }
  const sorted = [...models].sort();
  const order = new Map<string, number>();
  const remaining = new Set(models);
  let rank = 0;
  let progress = true;
  while (remaining.size && progress) {
    progress = false;
    for (const m of sorted) {
      if (!remaining.has(m)) continue;
      const unmet = [...deps.get(m)!].some((d) => remaining.has(d));
      if (!unmet) {
        order.set(m, rank++);
        remaining.delete(m);
        progress = true;
      }
    }
  }
  for (const m of sorted) if (remaining.has(m)) order.set(m, rank++); // cycle remainder
  return order;
}

/**
 * Discover resources straight from `/api/schema/` — collection paths
 * (`…/`, not `…/{id}/`). The list operationId is `<table>_list`, which gives us
 * the table name used by the WebSocket change-feed.
 */
export async function loadResources(): Promise<Resource[]> {
  const doc = await api.schema();
  const out: Resource[] = [];
  for (const [path, opsRaw] of Object.entries(doc.paths)) {
    if (!path.endsWith('/') || path.endsWith('}/')) continue;
    const ops = opsRaw as Record<string, { operationId?: string }>;
    const opId = ops.get?.operationId;
    if (!opId?.endsWith('_list')) continue;
    const table = opId.slice(0, -'_list'.length);
    const parts = path.split('/').filter(Boolean); // ["api","dcim","devices"]
    // model name from the Paginated<Model>List response ref
    const ref = (ops.get as any)?.responses?.['200']?.content?.['application/json']?.schema?.$ref as
      | string
      | undefined;
    const pag = ref?.split('/').pop();
    const model =
      pag?.startsWith('Paginated') && pag.endsWith('List')
        ? pag.slice('Paginated'.length, -'List'.length)
        : undefined;
    out.push({
      endpoint: path,
      table,
      section: parts[1] ?? '',
      label: titleize(parts[parts.length - 1] ?? table),
      model,
      writable: !!(ops as any).post,
      order: Number.MAX_SAFE_INTEGER,
    });
  }
  // rank by creation dependencies (prerequisites first)
  const models = new Set(out.map((r) => r.model).filter((m): m is string => !!m));
  const order = dependencyOrder(doc, models);
  for (const r of out) r.order = r.model ? (order.get(r.model) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  return out.sort((a, b) => (a.section + a.label).localeCompare(b.section + b.label));
}
