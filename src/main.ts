// Entry point: start the HTTP API. Configure via environment:
//   PB_DIALECT=sqlite  PB_SQLITE_FILE=./paashup.db
//   PB_DIALECT=mariadb DB_HOST=.. DB_PORT=.. DB_USER=.. DB_PASSWORD=.. DB_NAME=..
//   PORT=8000  BASE_URL=http://localhost:8000
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDb, type DbConfig } from './db/index.js';
import { createApiServer } from './api/server.js';
import { loadPlugins, loadedPlugins } from './plugins/runtime.js';
import { discoverPluginSpecifiers } from './plugins/discovery.js';
import { ensureWebhooks } from './webhooks.js';
import { ensureSeedToken } from './auth.js';
import { refreshServiceLinkIcons } from './service-links.js';
import { closeRealtime } from './realtime.js';
import type { Plugin } from './plugins/types.js';

/**
 * Resolve a plugin specifier for `import()`. Relative/absolute paths (e.g. a
 * `paashup.plugins` entry like `./dist/plugins/docker/index.js`) are resolved
 * against the project root (cwd), not this module's location under `dist/`; bare
 * package specifiers (`paashup-plugin-foo`) are imported as-is.
 */
function resolveSpecifier(spec: string): string {
  return spec.startsWith('.') || isAbsolute(spec)
    ? pathToFileURL(resolve(process.cwd(), spec)).href
    : spec;
}

function configFromEnv(): DbConfig {
  const dialect = (process.env.PB_DIALECT ?? 'sqlite') as 'sqlite' | 'mariadb';
  if (dialect === 'sqlite') {
    return { dialect, filename: process.env.PB_SQLITE_FILE ?? './paashup.db' };
  }
  return {
    dialect,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'paashup',
  };
}

const port = Number(process.env.PORT ?? 8000);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;
const db = createDb(configFromEnv());

// Load plugins before the server is created, so their entities/routes are part of
// the routing table. Sources: package.json (`paashup.plugins` + `paashup-plugin-*`
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
  // Create each plugin's default webhooks if they don't already exist.
  for (const p of plugins) {
    if (p.seedWebhooks?.length) await ensureWebhooks(db, p.seedWebhooks);
  }
}

// Deploy-time bootstrap: provision an API token from PB_SEED_TOKEN (idempotent), so a
// secure-by-default instance has a usable credential. No-op if PB_SEED_TOKEN is unset.
try {
  const seeded = await ensureSeedToken(db);
  if (seeded?.created)
    console.log(`seeded API token for user "${seeded.username}" (PB_SEED_TOKEN)`);
  else if (seeded) console.log(`API token for "${seeded.username}" already present; not reseeding`);
} catch (e) {
  console.warn(
    `PB_SEED_TOKEN: could not seed token — have migrations run? ${(e as Error).message}`,
  );
}

// Best-effort: resolve favicons for any pinned service link missing one. Never
// blocks startup; the dashboard's "Refresh icons" button retries on demand.
refreshServiceLinkIcons(db)
  .then(({ checked, updated }) => {
    if (checked) console.log(`service links: resolved ${updated}/${checked} icon(s)`);
  })
  .catch((e) =>
    console.warn(`service links: initial icon refresh failed — ${(e as Error).message}`),
  );

const server = createApiServer({
  db,
  baseUrl,
  // Secure by default: anonymous requests are rejected unless explicitly opted out
  // with PB_AUTH_REQUIRED=0 (e.g. for local dev). Set up a token or OIDC before going live.
  auth: { required: process.env.PB_AUTH_REQUIRED !== '0' },
  realtime: process.env.PB_REALTIME !== '0', // WebSocket change-feed on by default
  webRoot: process.env.PB_WEB_ROOT, // serve a built SPA if set (single-container)
});

server.listen(port, () => {
  console.log(`paashup API listening on ${baseUrl}`);
});

// Graceful shutdown on Ctrl+C (SIGINT) and SIGTERM (e.g. `docker stop`, systemd).
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return; // ignore repeated signals
  shuttingDown = true;
  console.log(`\nreceived ${signal}, shutting down…`);
  closeRealtime(); // terminate WebSocket clients so the HTTP server can close
  server.close(() => {
    void db.close().finally(() => process.exit(0));
  });
  server.closeAllConnections?.(); // drop lingering keep-alive HTTP connections
  // Safety net: force-exit if a graceful close stalls (e.g. a wedged socket).
  setTimeout(() => process.exit(0), 5000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => shutdown(sig));
}
