// Author-time type definitions for the paashup plugin API. A plugin is plain data
// + handler functions, so it needs NO runtime dependency on paashup — the host
// process provides everything. These types mirror paashup's `src` (keep in sync
// with github.com/SaaShup/paashup if the contract evolves).
declare module 'paashup' {
  // ---- database (passed to route handlers / hooks) ----
  export type Param = string | number | bigint | boolean | null | Uint8Array;
  export interface ExecResult {
    insertId: number;
    affectedRows: number;
  }
  export interface Db {
    readonly dialect: 'sqlite' | 'mariadb';
    query<T = Record<string, unknown>>(sql: string, params?: readonly Param[]): Promise<T[]>;
    get<T = Record<string, unknown>>(sql: string, params?: readonly Param[]): Promise<T | undefined>;
    execute(sql: string, params?: readonly Param[]): Promise<ExecResult>;
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  }

  // ---- entity metadata (drives the generic CRUD API) ----
  export type TsKind = 'number' | 'string' | 'boolean' | 'json';

  export interface ColumnMeta {
    name: string; // logical/API field name
    column: string; // physical DB column (FKs are `<name>_id`)
    tsKind: TsKind;
    nullable: boolean;
    writable: boolean;
    required: boolean;
    references?: string; // FK target model name
    genericRel?: string; // for `<rel>_type`/`<rel>_id` polymorphic pairs
    maxLength?: number;
    enum?: readonly (string | number)[];
    enumLabels?: Readonly<Record<string, string>>;
  }

  export interface RelationMeta {
    name: string;
    kind: 'tags' | 'm2m';
    target: string;
    targetTable: string;
    joinTable?: string;
    selfColumn?: string;
    targetColumn?: string;
  }

  export interface CountSpec {
    name: string;
    table: string;
    column: string;
  }

  export interface TableMeta {
    model: string; // PascalCase, e.g. "Widget"
    table: string; // physical table, e.g. "plugin_example_widget"
    section: string; // e.g. "plugins"
    endpoint: string; // "/api/plugins/<plugin>/<resource>/"
    origin: 'core' | 'external-full' | 'external-stub' | 'plugin';
    pk: string; // "id"
    columns: readonly ColumnMeta[];
    relations: readonly RelationMeta[];
    counts: readonly CountSpec[];
    objectType: string; // content-type, e.g. "plugins.widget"
    readOnly: boolean;
  }

  // ---- plugin manifest ----
  export interface Plugin {
    name: string; // url-safe; entities/routes live under /api/plugins/<name>/
    version: string;
    entities?: readonly PluginEntity[];
    migrations?: readonly PluginMigration[];
    routes?: readonly PluginRoute[];
    hooks?: readonly Hook[];
    customFields?: readonly CustomField[];
  }

  export interface PluginEntity {
    meta: TableMeta;
  }

  export interface PluginMigration {
    version: string; // e.g. "0001_initial"
    sqlite: string;
    mariadb: string;
  }

  export interface PluginRouteContext {
    db: Db;
    params: Record<string, string>;
    query: URLSearchParams;
    body: unknown;
  }
  export interface PluginRouteResult {
    status: number;
    body?: unknown;
  }
  export interface PluginRoute {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string; // absolute; may contain {param}
    handler: (ctx: PluginRouteContext) => Promise<PluginRouteResult> | PluginRouteResult;
  }

  export type HookEvent = 'created' | 'updated' | 'deleted';
  export interface Hook {
    table: string;
    event: HookEvent;
    handler: (ctx: { db: Db; id: number; row?: unknown }) => Promise<void> | void;
  }

  // ---- custom fields (attach to core or plugin entities) ----
  export type CustomFieldType = 'text' | 'integer' | 'boolean' | 'select';
  export interface CustomField {
    tables: readonly string[];
    name: string;
    type: CustomFieldType;
    label?: string;
    required?: boolean;
    default?: unknown;
    choices?: readonly string[];
  }
}
