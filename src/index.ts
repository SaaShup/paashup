// paasbox data-access layer — NetBox-compatible (DCIM/IPAM/Virtualization),
// no ORM, raw SQL over SQLite (small customers) or MariaDB (big customers).

export { createDb, SqliteDb, MariaDb } from './db/index.js';
export type { Db, Dialect, DbConfig, ExecResult, Param, MariaDbConfig } from './db/index.js';

export { repository, Repository, tables } from './repository/index.js';
export type { TableName, ListOptions, Page } from './repository/index.js';

export { createApiServer, Serializer, buildOpenApi } from './api/index.js';
export { attachRealtime, broadcast, clientCount } from './realtime.js';
export type { ChangeEvent } from './realtime.js';
export type { ServerOptions, Serialized } from './api/index.js';
export { ApiError, NotFoundError, ValidationError } from './errors.js';
export { authenticate, createToken, generateTokenKey } from './auth.js';
export type { AuthContext, AuthOptions, CreateTokenInput } from './auth.js';

export {
  loadPlugins,
  applyPluginMigrations,
  loadedPlugins,
  discoverPluginSpecifiers,
} from './plugins/index.js';
export { registerEntity, getTable, allTables } from './model/registry.js';
export { registerCustomField, customFieldsFor } from './customfields/registry.js';
export type { CustomField, CustomFieldType } from './customfields/types.js';
export type {
  Plugin,
  PluginEntity,
  PluginMigration,
  PluginRoute,
  PluginRouteContext,
  PluginRouteResult,
  Hook,
  HookEvent,
} from './plugins/index.js';

export type { ColumnMeta, TableMeta } from './model/meta-types.js';
export type * from './model/types.js';
