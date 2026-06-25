// NetBox → paasbox migration engine. Because paasbox mirrors the NetBox API, each
// core entity is migrated by GETting the *same* endpoint from NetBox and creating the
// objects locally. Two hard parts are handled here:
//   1. dependency order — entities are topologically sorted by their FK references so
//      a target (e.g. Manufacturer) is migrated before its dependants (DeviceType);
//   2. id remapping — NetBox ids differ from the new paasbox ids, so an id map per
//      table rewrites every FK. Self-references and forward references are resolved in
//      a final "link" pass once every id is known.
// Progress is tracked live: a count pass tallies the total up front, then `migrated`
// climbs as objects are created (see the optional `Progress` argument).
// Tags / M2M relations are not migrated in this version (scalar fields + FKs only).
import type { Db } from '../../db/types.js';
import type { TableMeta, ColumnMeta } from '../../model/meta-types.js';
import { allTables, getTable } from '../../model/registry.js';
import { Repository } from '../../repository/repository.js';
import { nbPages, nbCount, type NetboxConn } from './netbox.js';

type Obj = Record<string, unknown>;
type Id = number | string;

export interface MigrateOptions extends NetboxConn {
  /** Restrict to these tables and/or endpoints; omit to migrate all core entities. */
  only?: string[];
  /** Fetch + count only; don't write anything. */
  dryRun?: boolean;
}

export interface EntityReport {
  table: string;
  endpoint: string;
  total: number; // objects reported by NetBox for this entity
  fetched: number;
  created: number;
  linked: number;
  failed: number;
  errors: string[];
}
export interface MigrateResult {
  entities: EntityReport[];
  totals: { total: number; fetched: number; created: number; linked: number; failed: number };
}

/** Live progress for a running migration (mutated in place; read by the /progress/ route). */
export interface Progress {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  total: number; // total objects to migrate
  migrated: number; // created so far
  linked: number;
  failed: number;
  current: string | null; // entity currently being migrated
  result?: MigrateResult;
  error?: string;
}
export function newProgress(): Progress {
  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    total: 0,
    migrated: 0,
    linked: 0,
    failed: 0,
    current: null,
  };
}

const msg = (e: unknown): string => {
  if (e instanceof Error) {
    // Surface a ValidationError's field detail (e.g. {"virtual_machine":["…"]}) instead
    // of the bare "Validation failed", so migration errors are actionable.
    const detail = (e as { detail?: unknown }).detail;
    if (detail && typeof detail === 'object') return `${e.message}: ${JSON.stringify(detail)}`;
    return e.message;
  }
  return String(e);
};
const modelMap = (): Map<string, TableMeta> => new Map(allTables().map((m) => [m.model, m]));

/** Topologically order the selected core entities so REQUIRED FK targets come first. */
export function orderedEntities(only?: Set<string>): TableMeta[] {
  // Default scope is core entities; an explicit `only` may also target plugin entities
  // (e.g. plugin_docker_host) when the source NetBox has that plugin installed.
  const all = only
    ? allTables().filter((m) => !m.readOnly)
    : allTables().filter((m) => m.origin === 'core' && !m.readOnly);
  const selected = only ? all.filter((m) => only.has(m.table) || only.has(m.endpoint)) : all;
  const byModel = modelMap();
  const inSet = new Set(selected.map((m) => m.table));
  const deps = new Map<string, Set<string>>();
  for (const m of selected) {
    const s = new Set<string>();
    for (const c of m.columns) {
      // Only REQUIRED FKs constrain create order: they must exist when the row is
      // created (e.g. a VMInterface's virtual_machine). Nullable/optional FKs are left
      // unset at create and resolved in the link phase, so they don't constrain order —
      // and excluding them breaks NetBox's FK cycles (most run through nullable refs like
      // primary_ip / parent), which otherwise dump entities in registry order and can put
      // a dependent before its required target.
      if (!c.references || !c.required) continue;
      const t = byModel.get(c.references);
      if (t && t.table !== m.table && inSet.has(t.table)) s.add(t.table); // ignore self-refs
    }
    deps.set(m.table, s);
  }
  const order: TableMeta[] = [];
  const remaining = new Set(selected.map((m) => m.table));
  let progress = true;
  while (remaining.size && progress) {
    progress = false;
    for (const m of selected) {
      if (!remaining.has(m.table)) continue;
      if ([...deps.get(m.table)!].every((d) => !remaining.has(d))) {
        order.push(m);
        remaining.delete(m.table);
        progress = true;
      }
    }
  }
  for (const m of selected) if (remaining.has(m.table)) order.push(m); // cycle remainder
  return order;
}

const nbIdOf = (v: unknown): Id | null =>
  v == null ? null : typeof v === 'object' ? ((v as { id?: Id }).id ?? null) : (v as Id);

/** Build a paasbox create payload from a NetBox object; defer FKs not yet mapped. */
function transform(
  meta: TableMeta,
  nbObj: Obj,
  idMap: Map<string, Map<Id, Id>>,
  byModel: Map<string, TableMeta>,
): { data: Obj; defer: { col: string; table: string; nbId: Id }[] } {
  const data: Obj = {};
  const defer: { col: string; table: string; nbId: Id }[] = [];
  for (const c of meta.columns as readonly ColumnMeta[]) {
    if (!c.writable) continue;
    const v = nbObj[c.name];
    if (v === undefined) continue;
    if (c.references) {
      const nbId = nbIdOf(v);
      if (nbId == null) continue; // null FK → leave unset
      const target = byModel.get(c.references);
      if (!target) continue;
      const pbId = idMap.get(target.table)?.get(nbId);
      if (pbId != null) data[c.name] = pbId;
      else defer.push({ col: c.name, table: target.table, nbId }); // self/forward ref
    } else if (c.enum) {
      data[c.name] = v && typeof v === 'object' ? (v as { value?: unknown }).value : v; // choice
    } else if (v !== null) {
      data[c.name] = v; // scalar / json (custom_fields) passthrough
    }
  }
  return { data, defer };
}

export async function migrate(
  db: Db,
  opts: MigrateOptions,
  progress?: Progress,
): Promise<MigrateResult> {
  const conn: NetboxConn = { url: opts.url, token: opts.token };
  const only = opts.only?.length ? new Set(opts.only) : undefined;
  const byModel = modelMap();
  const entities = orderedEntities(only);
  const idMap = new Map<string, Map<Id, Id>>();
  const deferred: { table: string; pbId: Id; col: string; targetTable: string; nbId: Id }[] = [];
  const reports = new Map<string, EntityReport>();
  const reportOf = (m: TableMeta): EntityReport => {
    let r = reports.get(m.table);
    if (!r) {
      r = {
        table: m.table,
        endpoint: m.endpoint,
        total: 0,
        fetched: 0,
        created: 0,
        linked: 0,
        failed: 0,
        errors: [],
      };
      reports.set(m.table, r);
    }
    return r;
  };

  // ---- count phase: how many objects to migrate (for the progress total) ----
  let grandTotal = 0;
  for (const meta of entities) {
    const report = reportOf(meta);
    try {
      report.total = await nbCount(conn, meta.endpoint);
    } catch (e) {
      report.errors.push(`count: ${msg(e)}`);
    }
    grandTotal += report.total;
  }
  if (progress) progress.total = grandTotal;

  // ---- create phase (in dependency order) ----
  for (const meta of entities) {
    const report = reportOf(meta);
    if (progress) progress.current = meta.table;
    const map = new Map<Id, Id>();
    idMap.set(meta.table, map);
    const repo = new Repository<Obj>(db, meta);
    try {
      // Stream pages and create as we go → smooth progress + bounded memory.
      for await (const pageObjs of nbPages(conn, meta.endpoint)) {
        report.fetched += pageObjs.length;
        for (const nbObj of pageObjs) {
          const { data, defer } = transform(meta, nbObj, idMap, byModel);
          if (opts.dryRun) {
            report.created++;
            if (progress) progress.migrated++;
            continue;
          }
          try {
            const row = await repo.create(data);
            const pbId = (row as { id: Id }).id;
            const nbId = nbIdOf(nbObj.id);
            if (nbId != null) map.set(nbId, pbId);
            for (const d of defer)
              deferred.push({
                table: meta.table,
                pbId,
                col: d.col,
                targetTable: d.table,
                nbId: d.nbId,
              });
            report.created++;
            if (progress) progress.migrated++;
          } catch (e) {
            report.failed++;
            if (progress) progress.failed++;
            if (report.errors.length < 10) report.errors.push(`#${String(nbObj.id)}: ${msg(e)}`);
          }
        }
      }
    } catch (e) {
      report.errors.push(`fetch: ${msg(e)}`);
    }
  }

  // ---- link phase: resolve deferred self/forward FKs now that all ids exist ----
  if (!opts.dryRun) {
    if (progress) progress.current = '(linking)';
    const patches = new Map<string, { meta: TableMeta; pbId: Id; patch: Obj }>();
    for (const d of deferred) {
      const pbTarget = idMap.get(d.targetTable)?.get(d.nbId);
      if (pbTarget == null) continue;
      const key = `${d.table}:${d.pbId}`;
      const entry = patches.get(key) ?? { meta: getTable(d.table)!, pbId: d.pbId, patch: {} };
      entry.patch[d.col] = pbTarget;
      patches.set(key, entry);
    }
    for (const { meta, pbId, patch } of patches.values()) {
      const report = reportOf(meta);
      try {
        await new Repository<Obj>(db, meta).update(pbId, patch);
        report.linked++;
        if (progress) progress.linked++;
      } catch (e) {
        report.failed++;
        if (progress) progress.failed++;
        if (report.errors.length < 10) report.errors.push(`link #${String(pbId)}: ${msg(e)}`);
      }
    }
  }

  if (progress) progress.current = null;
  const list = [...reports.values()].filter((r) => r.total || r.fetched || r.errors.length);
  const totals = list.reduce(
    (t, r) => ({
      total: t.total + r.total,
      fetched: t.fetched + r.fetched,
      created: t.created + r.created,
      linked: t.linked + r.linked,
      failed: t.failed + r.failed,
    }),
    { total: 0, fetched: 0, created: 0, linked: 0, failed: 0 },
  );
  return { entities: list, totals };
}
