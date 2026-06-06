// Entry point: start the HTTP API. Configure via environment:
//   PB_DIALECT=sqlite  PB_SQLITE_FILE=./paasbox.db
//   PB_DIALECT=mariadb DB_HOST=.. DB_PORT=.. DB_USER=.. DB_PASSWORD=.. DB_NAME=..
//   PORT=8000  BASE_URL=http://localhost:8000
import { createDb, type DbConfig } from './db/index.js';
import { createApiServer } from './api/server.js';
import { loadPlugins, loadedPlugins } from './plugins/runtime.js';
import { discoverPluginSpecifiers } from './plugins/discovery.js';
import type { Plugin } from './plugins/types.js';

function configFromEnv(): DbConfig {
  const dialect = (process.env.PB_DIALECT ?? 'sqlite') as 'sqlite' | 'mariadb';
  if (dialect === 'sqlite') {
    return { dialect, filename: process.env.PB_SQLITE_FILE ?? './paasbox.db' };
  }
  return {
    dialect,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'paasbox',
  };
}

const port = Number(process.env.PORT ?? 8000);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;
const db = createDb(configFromEnv());

// Load plugins before the server is created, so their entities/routes are part of
// the routing table. Sources: package.json (`paasbox.plugins` + `paasbox-plugin-*`
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
    const mod = await import(spec);
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
});

server.listen(port, () => {
  console.log(`paasbox API listening on ${baseUrl}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  });
}
