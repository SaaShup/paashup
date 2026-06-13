// NetBox-style config contexts (core "extras" feature). A config context is a blob
// of arbitrary JSON `data` plus assignment criteria (regions, sites, roles, tags, …).
// For a given device or virtual machine, every *active* context whose criteria match
// the object is selected, ordered by (weight, name), and its `data` deep-merged into
// a single rendered config context (higher weight / later name wins on conflicts).
//
// Table is created by migration 0009. Registered at import — server.ts imports this
// module for the side effect (entity registration + the /render/ route).
import type { Db, Param } from './db/types.js';
import type { TableMeta, ColumnMeta } from './model/meta-types.js';
import { registerEntity, getTable } from './model/registry.js';
import { registerRoute } from './plugins/runtime.js';

export const CONFIGCONTEXT_TABLE = 'extras_configcontext';

/** Assignment-criteria columns: JSON arrays of object ids (empty = unrestricted). */
export const CRITERIA = [
  'regions',
  'site_groups',
  'sites',
  'locations',
  'device_types',
  'roles',
  'platforms',
  'cluster_types',
  'cluster_groups',
  'clusters',
  'tenant_groups',
  'tenants',
  'tags',
] as const;
type CriteriaKey = (typeof CRITERIA)[number];
type Criteria = Record<CriteriaKey, number[]>;

// ---- entity metadata ----------------------------------------------------------

type Col = ColumnMeta;
const col = (name: string, tsKind: Col['tsKind'], opts: Partial<Col> = {}): Col => ({
  name,
  column: name,
  tsKind,
  nullable: true,
  writable: true,
  required: false,
  ...opts,
});

const configContextMeta: TableMeta = {
  model: 'ConfigContext',
  table: CONFIGCONTEXT_TABLE,
  section: 'extras',
  endpoint: '/api/extras/config-contexts/',
  origin: 'core',
  pk: 'id',
  pkKind: 'number',
  objectType: 'extras.configcontext',
  readOnly: false,
  relations: [],
  counts: [],
  columns: [
    col('name', 'string', { nullable: false, required: true, maxLength: 100 }),
    col('weight', 'number', { nullable: false }),
    col('description', 'string', { nullable: false, maxLength: 200 }),
    col('is_active', 'boolean', { nullable: false }),
    col('data', 'json', { nullable: false }),
    ...CRITERIA.map((c) => col(c, 'json', { nullable: false })),
    col('created', 'string', { writable: false }),
    col('last_updated', 'string', { writable: false }),
  ],
};

registerEntity(configContextMeta);

// ---- rendering ----------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursively merge `over` into `base` (plain objects merge; everything else replaces). */
export function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; // proto-pollution guard
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out;
}

/** JSON columns come back from the raw driver as TEXT — parse leniently. */
function parseJson(v: unknown): unknown {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function emptyCriteria(): Criteria {
  return Object.fromEntries(CRITERIA.map((c) => [c, [] as number[]])) as Criteria;
}

/** Expand a set of ids to include all ancestors via `parent_id` (for tree models). */
async function withAncestors(db: Db, table: string, ids: number[]): Promise<number[]> {
  const seen = new Set<number>(ids);
  let frontier = [...ids];
  while (frontier.length) {
    const ph = frontier.map(() => '?').join(',');
    const rows = await db.query<{ id: number; parent_id: number | null }>(
      `SELECT id, parent_id FROM ${table} WHERE id IN (${ph})`,
      frontier as Param[],
    );
    const next: number[] = [];
    for (const r of rows) {
      if (r.parent_id != null && !seen.has(Number(r.parent_id))) {
        seen.add(Number(r.parent_id));
        next.push(Number(r.parent_id));
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** Replace tree-model criteria with their ancestor-expanded sets (parent matches child). */
async function expandTrees(db: Db, c: Criteria): Promise<void> {
  c.regions = await withAncestors(db, 'dcim_region', c.regions);
  c.site_groups = await withAncestors(db, 'dcim_site_group', c.site_groups);
  c.locations = await withAncestors(db, 'dcim_location', c.locations);
  c.tenant_groups = await withAncestors(db, 'tenancy_tenant_group', c.tenant_groups);
}

async function addTags(
  db: Db,
  c: Criteria,
  objectType: string,
  id: string | number,
): Promise<void> {
  const rows = await db.query<{ tag_id: number }>(
    `SELECT tag_id FROM tagging_taggeditem WHERE object_type = ? AND object_id = ?`,
    [objectType, String(id)],
  );
  for (const r of rows) c.tags.push(Number(r.tag_id));
}

const objectTypeOf = (table: string, fallback: string): string =>
  getTable(table)?.objectType ?? fallback;

/** Collect the assignment values that describe a device (for criteria matching). */
async function deviceCriteria(db: Db, id: string | number): Promise<Criteria | null> {
  const dev = await db.get<Record<string, unknown>>(
    `SELECT site_id, location_id, device_type_id, role_id, platform_id, tenant_id, cluster_id
       FROM dcim_device WHERE id = ?`,
    [String(id)],
  );
  if (!dev) return null;
  const c = emptyCriteria();
  if (dev.site_id != null) {
    c.sites.push(Number(dev.site_id));
    const site = await db.get<Record<string, unknown>>(
      `SELECT region_id, group_id FROM dcim_site WHERE id = ?`,
      [dev.site_id as Param],
    );
    if (site?.region_id != null) c.regions.push(Number(site.region_id));
    if (site?.group_id != null) c.site_groups.push(Number(site.group_id));
  }
  if (dev.location_id != null) c.locations.push(Number(dev.location_id));
  if (dev.device_type_id != null) c.device_types.push(Number(dev.device_type_id));
  if (dev.role_id != null) c.roles.push(Number(dev.role_id));
  if (dev.platform_id != null) c.platforms.push(Number(dev.platform_id));
  if (dev.tenant_id != null) await addTenant(db, c, dev.tenant_id as Param);
  if (dev.cluster_id != null) await addCluster(db, c, dev.cluster_id as Param);
  await addTags(db, c, objectTypeOf('dcim_device', 'dcim.device'), id);
  await expandTrees(db, c);
  return c;
}

/** Collect the assignment values that describe a virtual machine. */
async function vmCriteria(db: Db, id: string | number): Promise<Criteria | null> {
  const vm = await db.get<Record<string, unknown>>(
    `SELECT site_id, cluster_id, role_id, platform_id, tenant_id
       FROM virtualization_virtual_machine WHERE id = ?`,
    [id as Param],
  );
  if (!vm) return null;
  const c = emptyCriteria();
  if (vm.site_id != null) {
    c.sites.push(Number(vm.site_id));
    const site = await db.get<Record<string, unknown>>(
      `SELECT region_id, group_id FROM dcim_site WHERE id = ?`,
      [vm.site_id as Param],
    );
    if (site?.region_id != null) c.regions.push(Number(site.region_id));
    if (site?.group_id != null) c.site_groups.push(Number(site.group_id));
  }
  if (vm.cluster_id != null) await addCluster(db, c, vm.cluster_id as Param);
  if (vm.role_id != null) c.roles.push(Number(vm.role_id));
  if (vm.platform_id != null) c.platforms.push(Number(vm.platform_id));
  if (vm.tenant_id != null) await addTenant(db, c, vm.tenant_id as Param);
  await addTags(
    db,
    c,
    objectTypeOf('virtualization_virtual_machine', 'virtualization.virtualmachine'),
    id,
  );
  await expandTrees(db, c);
  return c;
}

async function addTenant(db: Db, c: Criteria, tenantId: Param): Promise<void> {
  c.tenants.push(Number(tenantId));
  const ten = await db.get<Record<string, unknown>>(
    `SELECT group_id FROM tenancy_tenant WHERE id = ?`,
    [tenantId],
  );
  if (ten?.group_id != null) c.tenant_groups.push(Number(ten.group_id));
}

async function addCluster(db: Db, c: Criteria, clusterId: Param): Promise<void> {
  c.clusters.push(Number(clusterId));
  const cl = await db.get<Record<string, unknown>>(
    `SELECT type_id, group_id FROM virtualization_cluster WHERE id = ?`,
    [clusterId],
  );
  if (cl?.type_id != null) c.cluster_types.push(Number(cl.type_id));
  if (cl?.group_id != null) c.cluster_groups.push(Number(cl.group_id));
}

/** A context applies when, for every non-empty criterion, the object's values intersect. */
function contextApplies(row: Record<string, unknown>, c: Criteria): boolean {
  for (const key of CRITERIA) {
    const set = parseJson(row[key]);
    if (!Array.isArray(set) || set.length === 0) continue; // unrestricted
    const objVals = c[key];
    if (!set.some((v) => objVals.includes(Number(v)))) return false;
  }
  return true;
}

export interface RenderedContext {
  config_context: Record<string, unknown>;
  applied: { id: number; name: string; weight: number }[];
}

/**
 * Compute the merged config context for a device or virtual machine. Returns null if
 * the target object does not exist. `target` is one of { device } | { virtualMachine }.
 */
export async function renderConfigContext(
  db: Db,
  target: { device?: string | number; virtualMachine?: string | number },
): Promise<RenderedContext | null> {
  const c =
    target.device != null
      ? await deviceCriteria(db, target.device)
      : target.virtualMachine != null
        ? await vmCriteria(db, target.virtualMachine)
        : null;
  if (!c) return null;

  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, name, weight, data, ${CRITERIA.join(', ')}
       FROM ${CONFIGCONTEXT_TABLE} WHERE is_active = 1`,
  );
  const applicable = rows
    .filter((r) => contextApplies(r, c))
    .map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      weight: Number(r.weight),
      data: parseJson(r.data),
    }))
    .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name));

  let merged: Record<string, unknown> = {};
  for (const ctx of applicable) {
    if (isPlainObject(ctx.data)) merged = deepMerge(merged, ctx.data);
  }
  return {
    config_context: merged,
    applied: applicable.map(({ id, name, weight }) => ({ id, name, weight })),
  };
}

// ---- render endpoint ----------------------------------------------------------
// GET /api/extras/config-contexts/render/?device=<id>  (or ?virtual_machine=<id>)
registerRoute({
  method: 'GET',
  path: '/api/extras/config-contexts/render/',
  handler: async ({ db, query }) => {
    const device = query.get('device');
    const vm = query.get('virtual_machine');
    if (!device && !vm) {
      return { status: 400, body: { detail: 'Provide ?device=<id> or ?virtual_machine=<id>.' } };
    }
    const result = await renderConfigContext(db, device ? { device } : { virtualMachine: vm! });
    if (!result) return { status: 404, body: { detail: 'Object not found.' } };
    return { status: 200, body: result };
  },
});
