import type { Db } from '../db/types.js';
import type { TableMeta } from '../model/meta-types.js';

/**
 * A plugin extends paasbox without touching core. Because the API engine is
 * metadata-driven, the main thing a plugin provides is **entity metadata** (which
 * the generic router/repository/serializer turn into a full NetBox-shaped CRUD API)
 * plus the SQL to create its tables. Plugins may also add custom routes and react
 * to write events via hooks.
 */
export interface Plugin {
  /** URL-safe identifier; entities/routes live under /api/plugins/<name>/. */
  readonly name: string;
  readonly version: string;
  readonly entities?: readonly PluginEntity[];
  /** Ordered schema migrations, tracked in `schema_migrations` like core ones. */
  readonly migrations?: readonly PluginMigration[];
  readonly routes?: readonly PluginRoute[];
  readonly hooks?: readonly Hook[];
}

/** An entity contributed by a plugin: table metadata (DDL lives in `migrations`). */
export interface PluginEntity {
  /** Table metadata; `endpoint` must be under `/api/plugins/<plugin>/<resource>/`. */
  readonly meta: TableMeta;
}

/**
 * One versioned migration for a plugin. Applied in `version` order and recorded
 * in `schema_migrations` as `plugin:<name>:<version>`, so each runs exactly once.
 */
export interface PluginMigration {
  readonly version: string; // e.g. "0001_initial"
  readonly sqlite: string;
  readonly mariadb: string;
}

export interface PluginRouteContext {
  readonly db: Db;
  /** Path params captured from `{name}` segments in the route path. */
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  /** Parsed JSON request body (for POST/PUT/PATCH). */
  readonly body: unknown;
}

export interface PluginRouteResult {
  readonly status: number;
  readonly body?: unknown;
}

/** A custom (non-CRUD) endpoint, e.g. GET /api/plugins/inventory/stats/. */
export interface PluginRoute {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Absolute path; may contain `{param}` segments. */
  readonly path: string;
  readonly handler: (ctx: PluginRouteContext) => Promise<PluginRouteResult> | PluginRouteResult;
}

export type HookEvent = 'created' | 'updated' | 'deleted';

/** React to a write on a table (fired by the API after a successful change). */
export interface Hook {
  readonly table: string;
  readonly event: HookEvent;
  readonly handler: (ctx: { db: Db; id: number; row?: unknown }) => Promise<void> | void;
}
