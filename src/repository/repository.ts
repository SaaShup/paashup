import { randomUUID } from 'node:crypto';
import type { Db, Param } from '../db/types.js';
import type { ColumnMeta, RelationMeta, TableMeta } from '../model/meta-types.js';
import { ApiError } from '../errors.js';
import { syncRelation, type RelationInput } from './relations.js';
import { validateWrite } from './validate.js';

export interface ListOptions {
  limit?: number;
  offset?: number;
  /**
   * Filters keyed by logical field name, optionally with a NetBox-style lookup
   * suffix: `status`, `name__ic`, `vid__gte`, `role__in`, `vrf__n`, `tenant__empty`.
   * Supported suffixes: (none)=exact, n=not, in, gt, gte, lt, lte, ic=contains,
   * isw=startswith, iew=endswith, empty=isnull (value "true"/"false").
   */
  filters?: Record<string, Param | Param[]>;
  /** Free-text search across this entity's text columns. */
  q?: string;
  /** Comma-separated logical field names; prefix with `-` for descending. */
  ordering?: string;
  /** Single-field ordering (alternative to `ordering`); defaults to the pk. */
  orderBy?: string;
  descending?: boolean;
}

/** Columns searched by the `q` parameter, when present on the entity. */
const SEARCH_FIELDS = [
  'name',
  'slug',
  'description',
  'comments',
  'label',
  'model',
  'ssid',
  'address',
  'prefix',
  'rd',
  'dns_name',
];

export interface Page<T> {
  results: T[];
  count: number;
  limit: number;
  offset: number;
}

const ident = (name: string) => '`' + name.replace(/`/g, '``') + '`';

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  if (v === undefined || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

/**
 * Generic, metadata-driven repository. One instance serves any entity; it maps
 * logical field names (`vrf`) to physical columns (`vrf_id`) and coerces JSON
 * and boolean values in both directions. No ORM — just parameterized SQL.
 */
export class Repository<TRow, TCreate = Partial<TRow>, TUpdate = Partial<TCreate>> {
  private readonly byName: Map<string, ColumnMeta>;
  /** Filter-field lookup: column names plus NetBox-style `<fk>_id` aliases. */
  private readonly byFilterName: Map<string, ColumnMeta>;
  /** `vrf_id AS vrf, status AS status, ...` plus the pk. */
  private readonly selectList: string;

  constructor(
    private readonly db: Db,
    readonly meta: TableMeta,
  ) {
    this.byName = new Map(meta.columns.map((c) => [c.name, c]));
    // FK fields are filterable by `<field>_id` (the related PK), as in NetBox —
    // e.g. `?host_id=13` for the `host` field on DockerRegistry.
    this.byFilterName = new Map(this.byName);
    for (const c of meta.columns) {
      if (c.references && !this.byFilterName.has(`${c.name}_id`)) {
        this.byFilterName.set(`${c.name}_id`, c);
      }
      for (const alias of c.filterAliases ?? []) {
        if (!this.byFilterName.has(alias)) this.byFilterName.set(alias, c);
      }
    }
    const exprs = [`${ident(meta.pk)} AS ${ident(meta.pk)}`];
    for (const c of meta.columns) {
      exprs.push(c.column === c.name ? ident(c.column) : `${ident(c.column)} AS ${ident(c.name)}`);
    }
    this.selectList = exprs.join(', ');
  }

  /** Coerce a raw id (from a URL or FK) to the table's pk type. */
  private pkValue(id: number | string): number | string {
    return this.meta.pkKind === 'string' ? String(id) : Number(id);
  }

  // ---- reads ----------------------------------------------------------------
  async retrieve(id: number | string): Promise<TRow | undefined> {
    const row = await this.db.get<Record<string, unknown>>(
      `SELECT ${this.selectList} FROM ${ident(this.meta.table)} WHERE ${ident(this.meta.pk)} = ?`,
      [this.pkValue(id)],
    );
    return row ? (this.rowOut(row) as TRow) : undefined;
  }

  /** Fetch many rows by id in chunked `IN (...)` queries (order not guaranteed). */
  async retrieveMany(ids: readonly (number | string)[]): Promise<TRow[]> {
    if (!ids.length) return [];
    const CHUNK = 900; // stay under SQLite's default 999 bound-variable limit
    const out: TRow[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK).map((x) => this.pkValue(x));
      const rows = await this.db.query<Record<string, unknown>>(
        `SELECT ${this.selectList} FROM ${ident(this.meta.table)} ` +
          `WHERE ${ident(this.meta.pk)} IN (${slice.map(() => '?').join(', ')})`,
        slice,
      );
      for (const r of rows) out.push(this.rowOut(r) as TRow);
    }
    return out;
  }

  async list(opts: ListOptions = {}): Promise<Page<TRow>> {
    const { where, params } = this.buildWhere(opts);
    const limit = clampInt(opts.limit, 50, 1, 1000);
    const offset = clampInt(opts.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const orderBy = this.buildOrderBy(opts);

    const countRow = await this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${ident(this.meta.table)}${where}`,
      params,
    );
    // LIMIT/OFFSET are inlined (validated integers) — some drivers reject them as params.
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT ${this.selectList} FROM ${ident(this.meta.table)}${where} ` +
        `ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return {
      results: rows.map((r) => this.rowOut(r) as TRow),
      count: Number(countRow?.n ?? 0),
      limit,
      offset,
    };
  }

  private buildOrderBy(opts: ListOptions): string {
    const terms: string[] = [];
    if (opts.ordering) {
      for (const raw of opts.ordering
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const desc = raw.startsWith('-');
        const name = desc ? raw.slice(1) : raw;
        const col = name === this.meta.pk ? this.meta.pk : this.byName.get(name)?.column;
        if (!col) throw new ApiError(400, `Unknown ordering field: ${name}`);
        terms.push(`${ident(col)} ${desc ? 'DESC' : 'ASC'}`);
      }
    } else if (opts.orderBy) {
      const col =
        opts.orderBy === this.meta.pk ? this.meta.pk : this.byName.get(opts.orderBy)?.column;
      if (!col) throw new ApiError(400, `Unknown ordering field: ${opts.orderBy}`);
      terms.push(`${ident(col)} ${opts.descending ? 'DESC' : 'ASC'}`);
    }
    if (!terms.length) terms.push(`${ident(this.meta.pk)} ASC`);
    return terms.join(', ');
  }

  // ---- writes ---------------------------------------------------------------
  async create(data: TCreate): Promise<TRow> {
    if (this.meta.readOnly) throw new ApiError(405, `${this.meta.model} is read-only`);
    const d = data as Record<string, unknown>;
    this.coerceScalars(d);
    validateWrite(this.meta, d, false);
    const rels = this.relationInputs(d);
    return this.db.transaction(async (tx) => {
      const r = new Repository<TRow, TCreate, TUpdate>(tx, this.meta);
      const id = await r.insertScalar(d);
      for (const [rel, items] of rels) await syncRelation(tx, this.meta, rel, id, items);
      const created = await r.retrieve(id);
      if (!created) throw new Error(`Row vanished after insert into ${this.meta.table}`);
      return created;
    });
  }

  async update(id: number | string, data: TUpdate): Promise<TRow | undefined> {
    if (this.meta.readOnly) throw new ApiError(405, `${this.meta.model} is read-only`);
    const d = data as Record<string, unknown>;
    this.coerceScalars(d);
    validateWrite(this.meta, d, true);
    const rels = this.relationInputs(d);
    return this.db.transaction(async (tx) => {
      const r = new Repository<TRow, TCreate, TUpdate>(tx, this.meta);
      if (!(await r.retrieve(id))) return undefined; // 404 — don't orphan relations
      const { columns, values } = this.writeColumns(d);
      if (columns.length) {
        const setClause = columns.map((c) => `${ident(c)} = ?`).join(', ');
        await tx.execute(
          `UPDATE ${ident(this.meta.table)} SET ${setClause} WHERE ${ident(this.meta.pk)} = ?`,
          [...values, this.pkValue(id)],
        );
      }
      for (const [rel, items] of rels) await syncRelation(tx, this.meta, rel, id, items);
      return r.retrieve(id);
    });
  }

  /** INSERT scalar columns only; returns the new id (uuid string for string PKs). */
  private async insertScalar(data: Record<string, unknown>): Promise<number | string> {
    const { columns, values } = this.writeColumns(data);
    // server-generated read-only values (e.g. uuid) — set on create only
    for (const col of this.meta.columns) {
      if (col.auto === 'uuid' && !columns.includes(col.column)) {
        columns.push(col.column);
        values.push(randomUUID());
      }
    }
    // UUID primary key: generate it here (the id column is read-only/never supplied)
    let pkVal: string | undefined;
    if (this.meta.pkKind === 'string' && !columns.includes(this.meta.pk)) {
      pkVal = randomUUID();
      columns.push(this.meta.pk);
      values.push(pkVal);
    }
    if (!columns.length)
      throw new ApiError(400, `No writable fields supplied for ${this.meta.model}`);
    const placeholders = columns.map(() => '?').join(', ');
    const res = await this.db.execute(
      `INSERT INTO ${ident(this.meta.table)} (${columns.map(ident).join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return pkVal ?? res.insertId;
  }

  /** Extract relation arrays present in the input body. */
  private relationInputs(data: Record<string, unknown>): [RelationMeta, RelationInput][] {
    const out: [RelationMeta, RelationInput][] = [];
    for (const rel of this.meta.relations) {
      const v = data[rel.name];
      if (v === undefined) continue;
      if (!Array.isArray(v)) throw new ApiError(400, `"${rel.name}" must be an array`);
      out.push([rel, v as RelationInput]);
    }
    return out;
  }

  async destroy(id: number | string): Promise<boolean> {
    if (this.meta.readOnly) throw new ApiError(405, `${this.meta.model} is read-only`);
    const res = await this.db.execute(
      `DELETE FROM ${ident(this.meta.table)} WHERE ${ident(this.meta.pk)} = ?`,
      [this.pkValue(id)],
    );
    return res.affectedRows > 0;
  }

  // ---- helpers --------------------------------------------------------------
  private buildWhere(opts: ListOptions): { where: string; params: Param[] } {
    const clauses: string[] = [];
    const params: Param[] = [];
    for (const [key, value] of Object.entries(opts.filters ?? {})) {
      const [name, lookup = ''] = key.split('__', 2) as [string, string?];
      const col =
        name === this.meta.pk
          ? ({ column: this.meta.pk, tsKind: 'number' } as ColumnMeta)
          : this.byFilterName.get(name);
      if (!col) throw new ApiError(400, `Unknown filter field "${name}" for ${this.meta.model}`);
      const c = ident(col.column);
      const effectiveLookup = lookup === '' && Array.isArray(value) ? 'in' : lookup;
      switch (effectiveLookup) {
        case '':
          if (value === null) clauses.push(`${c} IS NULL`);
          else {
            clauses.push(`${c} = ?`);
            params.push(this.valueIn(col, value as Param));
          }
          break;
        case 'n':
          clauses.push(`${c} <> ?`);
          params.push(this.valueIn(col, value as Param));
          break;
        case 'in': {
          const arr = Array.isArray(value) ? value : String(value).split(',');
          if (!arr.length) {
            clauses.push('1 = 0');
            break;
          }
          clauses.push(`${c} IN (${arr.map(() => '?').join(', ')})`);
          for (const v of arr) params.push(this.valueIn(col, v as Param));
          break;
        }
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const op = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[lookup]!;
          clauses.push(`${c} ${op} ?`);
          params.push(this.valueIn(col, value as Param));
          break;
        }
        case 'ic':
          clauses.push(`${c} LIKE ?`);
          params.push(`%${value}%`);
          break;
        case 'isw':
          clauses.push(`${c} LIKE ?`);
          params.push(`${value}%`);
          break;
        case 'iew':
          clauses.push(`${c} LIKE ?`);
          params.push(`%${value}`);
          break;
        case 'empty':
          clauses.push(
            String(value) === 'true'
              ? `(${c} IS NULL OR ${c} = '')`
              : `(${c} IS NOT NULL AND ${c} <> '')`,
          );
          break;
        default:
          throw new ApiError(400, `Unknown lookup "${lookup}" on field "${name}"`);
      }
    }
    if (opts.q) {
      const cols = SEARCH_FIELDS.map((n) => this.byName.get(n)).filter(
        (col): col is ColumnMeta => !!col && col.tsKind === 'string' && !col.enum,
      );
      if (cols.length) {
        clauses.push('(' + cols.map((col) => `${ident(col.column)} LIKE ?`).join(' OR ') + ')');
        for (const _ of cols) params.push(`%${opts.q}%`);
      }
    }
    return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }

  private writeColumns(data: Record<string, unknown>): { columns: string[]; values: Param[] } {
    const columns: string[] = [];
    const values: Param[] = [];
    for (const [name, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const col = this.byName.get(name);
      if (!col || !col.writable) continue; // silently ignore unknown / read-only keys
      columns.push(col.column);
      values.push(value === null ? null : this.valueIn(col, value as Param));
    }
    return { columns, values };
  }

  /**
   * Normalize scalar inputs in place before validation, accepting the shapes
   * clients commonly echo back from reads:
   *  - an FK given as a nested brief — `{"id": 20}` becomes `20`;
   *  - a `number` column given as a numeric string — `"14"` becomes `14`
   *    (matching DRF's IntegerField, which tolerates string-encoded numbers);
   *  - an enum value differing only in case — `"None"` becomes `"none"` — so the
   *    Docker agent's capitalized choices map onto our canonical lowercase ones.
   */
  private coerceScalars(data: Record<string, unknown>): void {
    for (const col of this.meta.columns) {
      if (!col.writable) continue;
      let v = data[col.name];
      // A blank choice on a nullable enum means "unset" → null (NetBox-style),
      // rather than failing the choice check (e.g. container `pid_mode: ""`).
      if (col.enum && col.nullable && v === '') {
        data[col.name] = null;
        continue;
      }
      // Enum value matching a choice only by case → canonical choice (agents send
      // Docker-cased values like `"None"`/`"Bridge"`). Exact matches are untouched.
      if (col.enum && typeof v === 'string' && !col.enum.includes(v)) {
        const lower = v.toLowerCase();
        const match = col.enum.find((c) => typeof c === 'string' && c.toLowerCase() === lower);
        if (match !== undefined) {
          data[col.name] = match;
          continue;
        }
      }
      // FK echoed back as its read brief ({ id, url, … }) — take the id.
      if (col.references && v && typeof v === 'object' && !Array.isArray(v)) {
        v = (v as { id?: unknown }).id ?? null;
        data[col.name] = v;
      }
      if (col.tsKind === 'number' && typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) data[col.name] = n;
      }
    }
  }

  /** Coerce a JS value into a DB param (JSON -> string). */
  private valueIn(col: ColumnMeta, value: unknown): Param {
    if (col.tsKind === 'json') return JSON.stringify(value);
    return value as Param;
  }

  /** Coerce a DB row into a JS object (JSON parse, 0/1 -> boolean). */
  private rowOut(row: Record<string, unknown>): Record<string, unknown> {
    const pkRaw = row[this.meta.pk];
    const out: Record<string, unknown> = {
      [this.meta.pk]: this.meta.pkKind === 'string' ? String(pkRaw) : Number(pkRaw),
    };
    for (const c of this.meta.columns) {
      const v = row[c.name];
      if (v === null || v === undefined) {
        out[c.name] = null;
        continue;
      }
      if (c.tsKind === 'boolean') out[c.name] = Boolean(v);
      else if (c.tsKind === 'json') out[c.name] = typeof v === 'string' ? JSON.parse(v) : v;
      else out[c.name] = v;
    }
    return out;
  }
}
