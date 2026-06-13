import type { Db } from '../db/types.js';
import type { TableMeta } from '../model/meta-types.js';
import { allTables, getTable, registryVersion } from '../model/registry.js';
import { Repository } from '../repository/repository.js';
import { readRelations } from '../repository/relations.js';
import { customFieldsFor } from '../customfields/registry.js';
import { computeFields } from './computed.js';

// Lookups derived from the registry, rebuilt when a plugin registers an entity.
let MODEL_TO_TABLE: Record<string, string> = {};
let CONTENTTYPE_TO_TABLE: Record<string, string> = {};
let lookupsVersion = -1;
function lookups() {
  if (lookupsVersion !== registryVersion()) {
    MODEL_TO_TABLE = {};
    CONTENTTYPE_TO_TABLE = {};
    for (const meta of allTables()) {
      MODEL_TO_TABLE[meta.model] = meta.table;
      CONTENTTYPE_TO_TABLE[meta.objectType] = meta.table;
    }
    lookupsVersion = registryVersion();
  }
  return { MODEL_TO_TABLE, CONTENTTYPE_TO_TABLE };
}

/** Generic-relation groups for a table: accessor -> {typeCol, idCol}. */
function genericGroups(meta: TableMeta): { accessor: string; typeCol: string; idCol: string }[] {
  const groups = new Map<string, { typeCol?: string; idCol?: string }>();
  for (const c of meta.columns) {
    if (!c.genericRel) continue;
    const g = groups.get(c.genericRel) ?? {};
    if (c.name.endsWith('_type')) g.typeCol = c.name;
    else if (c.name.endsWith('_id')) g.idCol = c.name;
    groups.set(c.genericRel, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.typeCol && g.idCol)
    .map(([accessor, g]) => ({ accessor, typeCol: g.typeCol!, idCol: g.idCol! }));
}

/** Columns to include when an entity is rendered as a nested brief. */
const BRIEF_FIELDS = [
  'name',
  'endpoint', // DockerHost — exposed in briefs so templates can use e.g. host.endpoint
  'slug',
  'description',
  'model',
  'rd',
  'prefix',
  'address',
  'vid',
  'asn',
  'ssid',
  'username',
  'label',
];

/** Columns used (in order of preference) to compute the `display` string. */
const DISPLAY_FIELDS = [
  'name',
  'model',
  'prefix',
  'address',
  'rd',
  'vid',
  'ssid',
  'username',
  'slug',
  'label',
  'zone_name',
];

export type Serialized = Record<string, unknown>;

const metaOf = (table: string) => getTable(table) as TableMeta;

/** NetBox blank value for a non-nullable column with no stored value. */
function scalarDefault(col: { tsKind: string }): unknown {
  switch (col.tsKind) {
    case 'json':
      return {};
    case 'boolean':
      return false;
    case 'number':
      return 0;
    default:
      return '';
  }
}

/** Coerce a raw id to a table's pk type (UUID tables keep strings). */
function pkId(meta: TableMeta, raw: unknown): number | string {
  return meta.pkKind === 'string' ? String(raw) : Number(raw);
}

/**
 * Renders repository rows into NetBox-shaped API objects: adds `url` / `display`,
 * expands foreign keys to nested briefs, and renders choice fields as
 * `{ value, label }`.
 *
 * FK expansion is **batched**: `objects()` collects every referenced id across the
 * whole result set, fetches each target table in a single `IN (...)` query, then
 * renders synchronously. A list of N rows costs ~1 query per distinct FK target
 * table, not N×(#FKs). A per-instance cache also dedupes across calls.
 */
export class Serializer {
  private readonly cache = new Map<string, Serialized | null>();
  /** relationName -> (ownerId -> targetIds[]) for the rows being serialized. */
  private relIds = new Map<string, Map<number | string, (number | string)[]>>();
  /** ownerId -> computed fields (family, children, _depth). */
  private computed = new Map<number | string, Record<string, unknown>>();

  constructor(
    private readonly db: Db,
    private readonly baseUrl: string,
  ) {}

  /** Full NetBox-shaped object for one row. */
  async object(table: string, row: Record<string, unknown>): Promise<Serialized> {
    return (await this.objects(table, [row]))[0]!;
  }

  /** Batched serialization of many rows of the same table. */
  async objects(table: string, rows: Record<string, unknown>[]): Promise<Serialized[]> {
    await this.prefetch(table, rows);
    this.computed = await computeFields(this.db, metaOf(table), rows);
    return rows.map((r) => this.render(table, r));
  }

  // ---- phase 1: collect FK + relation ids and load their briefs in bulk ----
  private async prefetch(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const { MODEL_TO_TABLE, CONTENTTYPE_TO_TABLE } = lookups();
    const meta = metaOf(table);
    const fkCols = meta.columns.filter((c) => c.references && MODEL_TO_TABLE[c.references]);
    const wanted = new Map<string, Set<number | string>>(); // target table -> ids to brief
    const want = (target: string, id: number | string) => {
      if (!this.cache.has(`${target}:${id}`)) {
        (wanted.get(target) ?? wanted.set(target, new Set()).get(target)!).add(id);
      }
    };

    // forward FKs
    for (const row of rows) {
      for (const col of fkCols) {
        const v = row[col.name];
        if (v === null || v === undefined) continue;
        const tt = MODEL_TO_TABLE[col.references!]!;
        want(tt, pkId(metaOf(tt), v));
      }
    }

    // generic (polymorphic) relations: resolve target table from the content-type
    const generics = genericGroups(meta);
    for (const row of rows) {
      for (const g of generics) {
        const id = row[g.idCol];
        const ct = row[g.typeCol];
        if (id == null || ct == null) continue;
        const target = CONTENTTYPE_TO_TABLE[String(ct)];
        if (target) want(target, pkId(metaOf(target), id));
      }
    }

    // M2M / tags: one query per relation, then brief the targets in bulk
    if (meta.relations.length) {
      const ownerIds = rows.map((r) => pkId(meta, r[meta.pk]));
      this.relIds = await readRelations(this.db, meta, ownerIds);
      for (const rel of meta.relations) {
        const perOwner = this.relIds.get(rel.name);
        if (!perOwner) continue;
        for (const targetIds of perOwner.values()) {
          for (const id of targetIds) want(rel.targetTable, id);
        }
      }
    }

    for (const [target, ids] of wanted) {
      const tmeta = metaOf(target);
      const found = await new Repository<Record<string, unknown>>(this.db, tmeta).retrieveMany([
        ...ids,
      ]);
      const seen = new Set<number | string>();
      for (const r of found) {
        const id = pkId(tmeta, r[tmeta.pk]);
        seen.add(id);
        this.cache.set(`${target}:${id}`, this.briefOf(tmeta, r));
      }
      for (const id of ids) if (!seen.has(id)) this.cache.set(`${target}:${id}`, null);
    }
  }

  // ---- phase 2: synchronous render using the populated cache ----------------
  private render(table: string, row: Record<string, unknown>): Serialized {
    const { MODEL_TO_TABLE, CONTENTTYPE_TO_TABLE } = lookups();
    const meta = metaOf(table);
    const id = pkId(meta, row[meta.pk]);
    const out: Serialized = {
      id,
      url: this.url(meta, id),
      display: this.display(meta, row),
      display_url: this.displayUrl(meta, id),
    };
    for (const col of meta.columns) {
      if (col.secret) continue; // write-only secret — never serialized on read
      const v = row[col.name];
      if (v === null || v === undefined) {
        // NetBox returns non-nullable blanks as type defaults ('' / {} / false / 0),
        // not null (FKs and choices stay null).
        out[col.name] = col.nullable || col.references || col.enum ? null : scalarDefault(col);
      } else if (col.enum) {
        out[col.name] = col.plainValue
          ? v
          : { value: v, label: col.enumLabels?.[String(v)] ?? String(v) };
      } else if (col.references) {
        const target = MODEL_TO_TABLE[col.references];
        out[col.name] = target
          ? (this.cache.get(`${target}:${pkId(metaOf(target), v)}`) ?? null)
          : v;
      } else {
        out[col.name] = v;
      }
    }
    // generic relations: nested object under the accessor (e.g. `scope`)
    for (const g of genericGroups(meta)) {
      const ctVal = row[g.typeCol];
      const idVal = row[g.idCol];
      if (idVal == null || ctVal == null) {
        out[g.accessor] = null;
      } else {
        const target = CONTENTTYPE_TO_TABLE[String(ctVal)];
        out[g.accessor] = target
          ? (this.cache.get(`${target}:${pkId(metaOf(target), idVal)}`) ?? null)
          : null;
      }
    }
    // M2M / tags as brief arrays (preserve target order, drop dangling)
    for (const rel of meta.relations) {
      const targetIds = this.relIds.get(rel.name)?.get(id) ?? [];
      out[rel.name] = targetIds
        .map((tid) => this.cache.get(`${rel.targetTable}:${tid}`))
        .filter((b): b is Serialized => !!b);
    }
    if (!('tags' in out)) out.tags = [];
    // computed read-only fields (family, children, _depth)
    Object.assign(out, this.computed.get(id) ?? {});
    // custom fields: surface every defined field, filling defaults when unset
    const cfs = customFieldsFor(meta.table);
    if (cfs.length) {
      const stored =
        out.custom_fields &&
        typeof out.custom_fields === 'object' &&
        !Array.isArray(out.custom_fields)
          ? (out.custom_fields as Record<string, unknown>)
          : {};
      const result: Record<string, unknown> = {};
      for (const cf of cfs)
        result[cf.name] = cf.name in stored ? stored[cf.name] : (cf.default ?? null);
      out.custom_fields = result;
    }
    return out;
  }

  // ---- helpers --------------------------------------------------------------
  private url(meta: TableMeta, id: number | string): string {
    return `${this.baseUrl}${meta.endpoint}${id}/`;
  }

  /** Web-UI URL (NetBox `display_url`): like `url` but without the `/api` prefix. */
  private displayUrl(meta: TableMeta, id: number | string): string {
    return `${this.baseUrl}${meta.endpoint.replace('/api/', '/')}${id}/`;
  }

  private display(meta: TableMeta, row: Record<string, unknown>): string {
    for (const f of DISPLAY_FIELDS) {
      const v = row[f];
      if (typeof v === 'string' && v) return v;
      if (typeof v === 'number') return String(v);
    }
    return `${meta.model} (${row[meta.pk]})`;
  }

  private briefOf(meta: TableMeta, row: Record<string, unknown>): Serialized {
    const id = pkId(meta, row[meta.pk]);
    const brief: Serialized = { id, url: this.url(meta, id), display: this.display(meta, row) };
    for (const f of BRIEF_FIELDS) {
      if (f in row && row[f] !== undefined) brief[f] = row[f];
    }
    return brief;
  }
}
