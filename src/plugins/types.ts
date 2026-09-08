import type { Db } from '../db/types.js';
import type { TableMeta } from '../model/meta-types.js';
import type { CustomField } from '../customfields/types.js';
import type { WebhookSeed } from '../webhooks.js';

/**
 * A plugin extends paas2box without touching core. Because the API engine is
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
  /** WebSocket endpoints */
  readonly websockets?: readonly PluginWebSocketRoute[];
  readonly hooks?: readonly Hook[];
  /** Custom fields to attach to core/plugin entities (stored in `custom_fields`). */
  readonly customFields?: readonly CustomField[];
  /**
   * Default webhooks the plugin needs (e.g. the Docker agent integration). Created
   * at startup if missing — see `ensureWebhooks` — and never modified thereafter.
   */
  readonly seedWebhooks?: readonly WebhookSeed[];
  /**
   * Static asset directories the engine serves verbatim (HTML/JS/CSS/…), letting a
   * plugin ship its own web UI. Combined with a `…/ui/` route (see PluginUiMenu) the
   * web app shows a sidebar entry for it. Served unauthenticated, like the core SPA.
   */
  readonly assets?: readonly PluginAssetMount[];
}

/** Mounts the files under `dir` at `urlPrefix` (must be under /api/plugins/<name>/). */
export interface PluginAssetMount {
  readonly urlPrefix: string;
  readonly dir: string;
}

/**
 * Optional convention: a plugin route `GET /api/plugins/<name>/ui/` returning this lets
 * the web app render sidebar entries for plugin-served pages (opened in an embedded
 * frame). `url` is a page to load (typically one of the plugin's own `assets`).
 */
export interface PluginUiMenu {
  readonly menu: readonly { label: string; url: string; icon?: string }[];
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
  /**
   * Externally visible request origin (`scheme://host`), honoring a configured public
   * URL / PB_TRUST_PROXY. For defaulting origin fields like a host's `netbox_base_url`.
   */
  readonly origin: string;
}

export interface PluginRouteResult {
  readonly status: number;
  readonly body?: unknown;
}

export interface PluginWebSocketContext {
  readonly db: Db;
  /** Path params captured from `{name}` segments in the route path. */
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  /** The HTTP upgrade request. Already authenticated when the server requires auth. */
  readonly req: import('node:http').IncomingMessage;
  /** The raw socket of the upgrade request, to complete or abort the handshake. */
  readonly socket: import('node:stream').Duplex;
  /** The first packet of the upgraded stream. */
  readonly head: Buffer;
  /**
   * Refuse the upgrade with a plain HTTP status (writes the response and ends the
   * socket), e.g. 404 when the target object doesn't exist.
   */
  readonly reject: (status: number, message?: string) => void;
}

export interface PluginWebSocketRoute {
  /** Absolute path; may contain `{param}` segments. */
  readonly path: string;
  readonly handler: (ctx: PluginWebSocketContext) => Promise<void> | void;
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
  readonly handler: (ctx: { db: Db; id: number | string; row?: unknown }) => Promise<void> | void;
}
