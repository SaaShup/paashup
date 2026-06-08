// Entry point: start the HTTP API. Configure via environment:
//   PB_DIALECT=sqlite  PB_SQLITE_FILE=./paas2box.db
//   PB_DIALECT=mariadb DB_HOST=.. DB_PORT=.. DB_USER=.. DB_PASSWORD=.. DB_NAME=..
//   PORT=8000  BASE_URL=http://localhost:8000
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDb, type DbConfig } from './db/index.js';
import { createApiServer } from './api/server.js';
import { loadPlugins, loadedPlugins } from './plugins/runtime.js';
import { discoverPluginSpecifiers } from './plugins/discovery.js';
import type { Plugin } from './plugins/types.js';

/**
 * Resolve a plugin specifier for `import()`. Relative/absolute paths (e.g. a
 * `paas2box.plugins` entry like `./dist/plugins/docker/index.js`) are resolved
 * against the project root (cwd), not this module's location under `dist/`; bare
 * package specifiers (`paas2box-plugin-foo`) are imported as-is.
 */
function resolveSpecifier(spec: string): string {
  return spec.startsWith('.') || isAbsolute(spec)
    ? pathToFileURL(resolve(process.cwd(), spec)).href
    : spec;
}

function configFromEnv(): DbConfig {
  const dialect = (process.env.PB_DIALECT ?? 'sqlite') as 'sqlite' | 'mariadb';
  if (dialect === 'sqlite') {
    return { dialect, filename: process.env.PB_SQLITE_FILE ?? './paas2box.db' };
  }
  return {
    dialect,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'paas2box',
  };
}

const port = Number(process.env.PORT ?? 8000);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;
const db = createDb(configFromEnv());

// Load plugins before the server is created, so their entities/routes are part of
// the routing table. Sources: package.json (`paas2box.plugins` + `paas2box-plugin-*`
// deps) merged with the PB_PLUGINS env list.
const pluginPaths = [
  ...discoverPluginSpecifiers(process.cwd()),
  ...(process.env.PB_PLUGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
].filter((v, i, a) => a.indexOf(v) === i);
if (pluginPaths.length) {
  const plugins: Plugin[] = [];
  for (const spec of pluginPaths) {
    const mod = await import(resolveSpecifier(spec));
    plugins.push((mod.default ?? mod) as Plugin);
  }
  await loadPlugins(db, plugins);
  console.log(
    `loaded plugins: ${loadedPlugins()
      .map((p) => `${p.name}@${p.version}`)
      .join(', ')}`,
  );
}

const server = createApiServer({
  db,
  baseUrl,
  auth: { required: process.env.PB_AUTH_REQUIRED === '1' },
  realtime: process.env.PB_REALTIME !== '0', // WebSocket change-feed on by default
  webRoot: process.env.PB_WEB_ROOT, // serve a built SPA if set (single-container)
});

server.listen(port, () => {
  console.log(`paas2box API listening on ${baseUrl}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  });
}
