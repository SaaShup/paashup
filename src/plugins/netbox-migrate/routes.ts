// HTTP surface for the migration tool.
//   GET  /api/plugins/netbox-migrate/          → usage
//   POST /api/plugins/netbox-migrate/run/       → start a migration (body: url, token, …)
//   GET  /api/plugins/netbox-migrate/progress/  → live counter (migrated / total)
import type { PluginRoute } from '../../plugins/types.js';
import { migrate, newProgress, type Progress } from './migrate.js';
import { nbStatus } from './netbox.js';
import { UI_PREFIX } from './ui.js';

const USAGE = {
  detail: 'Migrate core objects from a NetBox instance into paashup via its REST API.',
  endpoints: {
    run: 'POST /api/plugins/netbox-migrate/run/',
    progress: 'GET /api/plugins/netbox-migrate/progress/',
  },
  body: {
    url: 'NetBox base URL, e.g. https://netbox.example.com (required)',
    token: 'NetBox API token with read access to all objects (required)',
    only: 'optional array of table names/endpoints to restrict the migration',
    dry_run: 'optional boolean — fetch + count without writing',
    wait: 'optional boolean — run synchronously and return the full report (default: start in the background and poll /progress/)',
  },
  notes: [
    'Entities migrate in FK-dependency order; ids are remapped automatically.',
    'Self/forward references are resolved in a final link pass.',
    'Follow progress via /progress/ (migrated vs total). Tags/M2M are not migrated yet.',
  ],
};

// One migration at a time; its progress is observable while it runs.
let live: Progress = newProgress();

const snapshot = (p: Progress) => ({
  running: p.running,
  total: p.total,
  migrated: p.migrated,
  linked: p.linked,
  failed: p.failed,
  percent: p.total ? Math.round((p.migrated / p.total) * 100) : p.running ? 0 : 100,
  current: p.current,
  started_at: p.startedAt,
  finished_at: p.finishedAt,
  done: !p.running && p.finishedAt != null,
  error: p.error ?? null,
  result: p.result ?? null,
});

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const routes: PluginRoute[] = [
  {
    method: 'GET',
    path: '/api/plugins/netbox-migrate/',
    handler: () => ({ status: 200, body: USAGE }),
  },
  {
    method: 'GET',
    path: '/api/plugins/netbox-migrate/progress/',
    handler: () => ({ status: 200, body: snapshot(live) }),
  },
  {
    // Sidebar manifest: paashup renders this as a menu entry opening the UI page.
    method: 'GET',
    path: '/api/plugins/netbox-migrate/ui/',
    handler: () => ({
      status: 200,
      body: {
        menu: [{ label: 'NetBox Migrate', url: UI_PREFIX, icon: 'mdi mdi-database-import' }],
      },
    }),
  },
  {
    method: 'POST',
    path: '/api/plugins/netbox-migrate/run/',
    handler: async ({ db, body }) => {
      const b = (body ?? {}) as Record<string, unknown>;
      const raw = String(b.url ?? '').trim();
      // Tolerate a scheme-less URL (e.g. "127.0.0.1:8081") — default to http://.
      const url = raw && !/^https?:\/\//i.test(raw) ? `http://${raw}` : raw;
      const token = String(b.token ?? '').trim();
      if (!url || !token) {
        return {
          status: 400,
          body: { detail: 'Provide "url" (NetBox base) and "token" (API key).' },
        };
      }
      if (live.running) {
        return {
          status: 409,
          body: { detail: 'A migration is already running.', progress: snapshot(live) },
        };
      }
      // Fail fast with a clear message if NetBox isn't reachable / the token is wrong.
      try {
        await nbStatus({ url, token });
      } catch (e) {
        return { status: 502, body: { detail: `Cannot reach NetBox: ${msg(e)}` } };
      }

      const opts = {
        url,
        token,
        only: Array.isArray(b.only) ? b.only.map(String) : undefined,
        dryRun: b.dry_run === true,
      };
      live = newProgress();
      live.running = true;
      live.startedAt = Date.now();

      if (b.wait === true) {
        // Synchronous: run to completion and return the full report.
        try {
          const result = await migrate(db, opts, live);
          live.result = result;
          return { status: 200, body: { ...result, progress: snapshot(live) } };
        } catch (e) {
          live.error = msg(e);
          return { status: 500, body: { detail: msg(e) } };
        } finally {
          live.running = false;
          live.finishedAt = Date.now();
        }
      }

      // Default: start in the background; the client polls /progress/.
      void (async () => {
        try {
          live.result = await migrate(db, opts, live);
        } catch (e) {
          live.error = msg(e);
        } finally {
          live.running = false;
          live.finishedAt = Date.now();
        }
      })();
      return {
        status: 202,
        body: {
          detail: 'Migration started. Poll GET /api/plugins/netbox-migrate/progress/ to follow it.',
          progress: snapshot(live),
        },
      };
    },
  },
];
