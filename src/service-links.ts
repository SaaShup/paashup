// Pinned "services" panel on the dashboard: quick links to things like Grafana,
// Prometheus, Keycloak… added by hand through the entity's normal CRUD API. The icon
// is resolved automatically by fetching the page and reading its <link rel="icon">
// (see resolveFaviconUrl), unless the admin sets one explicitly via `icon_url`.
import type { Db } from './db/types.js';
import type { TableMeta } from './model/meta-types.js';
import { registerEntity } from './model/registry.js';
import { registerRoute } from './plugins/runtime.js';

export const SERVICE_LINK_TABLE = 'extras_service_link';

const serviceLinkMeta: TableMeta = {
  model: 'ServiceLink',
  table: SERVICE_LINK_TABLE,
  section: 'extras',
  endpoint: '/api/extras/service-links/',
  origin: 'core',
  pk: 'id',
  objectType: 'extras.servicelink',
  readOnly: false,
  relations: [],
  counts: [],
  columns: [
    {
      name: 'key',
      column: 'key',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 100,
    },
    {
      name: 'label',
      column: 'label',
      tsKind: 'string',
      nullable: false,
      writable: true,
      required: true,
      maxLength: 150,
    },
    {
      name: 'override_url',
      column: 'override_url',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 500,
    },
    {
      name: 'icon_url',
      column: 'icon_url',
      tsKind: 'string',
      nullable: true,
      writable: true,
      required: false,
      maxLength: 500,
    },
    {
      name: 'auto_icon_url',
      column: 'auto_icon_url',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
      maxLength: 500,
    },
    {
      name: 'pinned',
      column: 'pinned',
      tsKind: 'boolean',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'position',
      column: 'position',
      tsKind: 'number',
      nullable: false,
      writable: true,
      required: false,
    },
    {
      name: 'created',
      column: 'created',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
    },
    {
      name: 'last_updated',
      column: 'last_updated',
      tsKind: 'string',
      nullable: true,
      writable: false,
      required: false,
    },
  ],
};

registerEntity(serviceLinkMeta);

// ---- favicon auto-detection -----------------------------------------------------

/**
 * Most self-hosted services don't serve a plain `/favicon.ico` — their page instead
 * declares one via `<link rel="icon" href="whatever.svg">` (often not even at the
 * site root). Fetch the page and read that, resolving a relative href against it.
 * Prefers a plain `rel="icon"` over `apple-touch-icon`/other icon variants.
 */
async function resolveFaviconUrl(pageUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: 'text/html',
        // Some reverse proxies / WAFs (fronting Grafana, Keycloak, …) serve a
        // different (icon-less) response to requests without a browser-looking
        // User-Agent — Node's default is otherwise a dead giveaway.
        'User-Agent': 'Mozilla/5.0 (compatible; paashup/1.0; +service-links favicon lookup)',
      },
    });
    if (!res.ok) {
      console.warn(`service links: GET ${pageUrl} -> ${res.status}, no icon`);
      return undefined;
    }
    const html = (await res.text()).slice(0, 200_000); // the <head> is always near the top
    let best: { rel: string; href: string } | undefined;
    for (const m of html.matchAll(/<link\b[^>]*rel=["']([^"']*icon[^"']*)["'][^>]*>/gi)) {
      const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const rel = (m[1] ?? '').toLowerCase();
      if (!best || (rel === 'icon' && best.rel !== 'icon')) best = { rel, href };
    }
    if (!best) {
      console.warn(`service links: no <link rel="icon"> found at ${res.url}`);
      return undefined;
    }
    return new URL(best.href, res.url).toString();
  } catch (e) {
    // unreachable / timed out / blocked — log why, since this fails silently otherwise
    console.warn(`service links: favicon lookup failed for ${pageUrl} — ${(e as Error).message}`);
    return undefined;
  }
}

/** Re-resolves `auto_icon_url` for every pinned link that has a URL but no manual
 *  `icon_url` override. Each lookup is its own page fetch (up to 8s), so they run
 *  concurrently — doing them one at a time would make the wait add up per link. */
export async function refreshServiceLinkIcons(
  db: Db,
): Promise<{ checked: number; updated: number }> {
  const rows = await db.query<{ id: number; override_url: string | null }>(
    `SELECT id, override_url FROM ${SERVICE_LINK_TABLE} WHERE pinned = 1 AND (icon_url IS NULL OR icon_url = '')`,
  );
  const results = await Promise.all(
    rows.map(async (row) => {
      if (!row.override_url) return false;
      const icon = await resolveFaviconUrl(row.override_url);
      if (!icon) return false;
      await db.execute(`UPDATE ${SERVICE_LINK_TABLE} SET auto_icon_url = ? WHERE id = ?`, [
        icon,
        row.id,
      ]);
      return true;
    }),
  );
  return { checked: rows.length, updated: results.filter(Boolean).length };
}

// POST /api/extras/service-links/refresh-icons/ — re-run favicon lookup for every
// pinned link missing an icon (e.g. a "Refresh icons" button next to the dashboard's
// services panel, or a new link that was just added).
registerRoute({
  method: 'POST',
  path: '/api/extras/service-links/refresh-icons/',
  handler: async ({ db }) => {
    try {
      return { status: 200, body: await refreshServiceLinkIcons(db) };
    } catch (e) {
      return { status: 502, body: { detail: (e as Error).message } };
    }
  },
});
