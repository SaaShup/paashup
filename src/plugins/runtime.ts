import type { Db } from '../db/types.js';
import { registerEntity } from '../model/registry.js';
import type { Hook, HookEvent, Plugin, PluginRoute } from './types.js';

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

/** Register plugins: add their entities, apply idempotent DDL, mount routes/hooks. */
export async function loadPlugins(db: Db, plugins: readonly Plugin[]): Promise<void> {
  for (const plugin of plugins) {
    for (const entity of plugin.entities ?? []) {
      registerEntity(entity.meta);
      const ddl = db.dialect === 'sqlite' ? entity.migration.sqlite : entity.migration.mariadb;
      for (const stmt of statements(ddl)) {
        await db.execute(stmt);
      }
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
