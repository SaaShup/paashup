import type { Db } from '../db/types.js';
import { getTable, registerEntity } from '../model/registry.js';
import type { Hook, HookEvent, Plugin, PluginMigration, PluginRoute } from './types.js';

interface CompiledRoute {
  method: string;
  regex: RegExp;
  params: string[];
  route: PluginRoute;
}

const routes: CompiledRoute[] = [];
const hooks = new Map<string, Hook[]>(); // key: `${table}:${event}`
const loaded: { name: string; version: string }[] = [];

function compile(route: PluginRoute): CompiledRoute {
  const params: string[] = [];
  const pattern = route.path.replace(/\{(\w+)\}/g, (_, name) => {
    params.push(name);
    return '([^/]+)';
  });
  return { method: route.method, regex: new RegExp(`^${pattern}$`), params, route };
}

/** Split simple DDL into individual statements (no procedures in plugin DDL). */
function statements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

async function ensureMigrationsTable(db: Db): Promise<void> {
  if (db.dialect === 'sqlite') {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    );
  } else {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version VARCHAR(255) PRIMARY KEY,
         applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
  }
}

/**
 * Apply a plugin's pending migrations in order, each recorded as
 * `plugin:<name>:<version>` so it runs exactly once. Returns versions applied now.
 */
export async function applyPluginMigrations(
  db: Db,
  name: string,
  migrations: readonly PluginMigration[],
): Promise<string[]> {
  if (!migrations.length) return [];
  await ensureMigrationsTable(db);
  const applied = new Set(
    (await db.query<{ version: string }>('SELECT version FROM schema_migrations')).map(
      (r) => r.version,
    ),
  );
  const done: string[] = [];
  for (const m of [...migrations].sort((a, b) => a.version.localeCompare(b.version))) {
    const version = `plugin:${name}:${m.version}`;
    if (applied.has(version)) continue;
    const ddl = db.dialect === 'sqlite' ? m.sqlite : m.mariadb;
    await db.transaction(async (tx) => {
      for (const stmt of statements(ddl)) await tx.execute(stmt);
      await tx.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    });
    done.push(version);
  }
  return done;
}

/** Register plugins: add entities, apply pending migrations, mount routes/hooks. */
export async function loadPlugins(db: Db, plugins: readonly Plugin[]): Promise<void> {
  for (const plugin of plugins) {
    await applyPluginMigrations(db, plugin.name, plugin.migrations ?? []);
    for (const entity of plugin.entities ?? []) {
      if (!getTable(entity.meta.table)) registerEntity(entity.meta); // safe on reload
    }
    for (const route of plugin.routes ?? []) {
      routes.push(compile(route));
    }
    for (const hook of plugin.hooks ?? []) {
      const key = `${hook.table}:${hook.event}`;
      (hooks.get(key) ?? hooks.set(key, []).get(key)!).push(hook);
    }
    loaded.push({ name: plugin.name, version: plugin.version });
  }
}

/** Find a custom plugin route for a request, capturing path params. */
export function matchRoute(
  method: string,
  pathname: string,
): { route: PluginRoute; params: Record<string, string> } | null {
  const p = pathname.endsWith('/') ? pathname : `${pathname}/`;
  for (const c of routes) {
    if (c.method !== method) continue;
    const m = c.regex.exec(p);
    if (m) {
      const params: Record<string, string> = {};
      c.params.forEach((name, i) => (params[name] = m[i + 1]!));
      return { route: c.route, params };
    }
  }
  return null;
}

/** Fire any hooks registered for a table/event (best-effort, after the API write). */
export async function fireHooks(
  db: Db,
  table: string,
  event: HookEvent,
  id: number,
  row?: unknown,
): Promise<void> {
  for (const hook of hooks.get(`${table}:${event}`) ?? []) {
    await hook.handler({ db, id, row });
  }
}

export function loadedPlugins(): readonly { name: string; version: string }[] {
  return loaded;
}
