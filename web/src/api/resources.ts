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
}

function titleize(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Discover resources straight from `/api/schema/` — collection paths
 * (`…/`, not `…/{id}/`). The list operationId is `<table>_list`, which gives us
 * the table name used by the WebSocket change-feed.
 */
export async function loadResources(): Promise<Resource[]> {
  const doc = await api.schema();
  const out: Resource[] = [];
  for (const [path, ops] of Object.entries(doc.paths)) {
    if (!path.endsWith('/') || path.endsWith('}/')) continue;
    const opId = ops.get?.operationId;
    if (!opId?.endsWith('_list')) continue;
    const table = opId.slice(0, -'_list'.length);
    const parts = path.split('/').filter(Boolean); // ["api","dcim","devices"]
    out.push({
      endpoint: path,
      table,
      section: parts[1] ?? '',
      label: titleize(parts[parts.length - 1] ?? table),
    });
  }
  return out.sort((a, b) => (a.section + a.label).localeCompare(b.section + b.label));
}
