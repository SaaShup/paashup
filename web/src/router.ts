import type { useUiStore } from './stores/ui.js';
import { BASE } from './base.js';

type UiStore = ReturnType<typeof useUiStore>;

export type Route =
  | { view: 'dashboard' }
  | { view: 'docs' }
  | { view: 'api-keys' }
  | { view: 'list'; table: string; filters?: Record<string, string> }
  | { view: 'detail'; table: string; id: number }
  | { view: 'plugin-page'; plugin: string; label: string };

/** First path segments that are views of their own, never table names. */
const RESERVED = new Set(['docs', 'api-keys', 'plugin']);

/** The route describing the store's current view, or null when it can't be expressed. */
export function routeOf(ui: UiStore): Route | null {
  switch (ui.view) {
    case 'dashboard':
    case 'docs':
    case 'api-keys':
      return { view: ui.view };
    case 'plugin-page':
      return ui.pluginPage
        ? { view: 'plugin-page', plugin: ui.pluginPage.plugin, label: ui.pluginPage.label }
        : null;
    case 'list':
      return ui.selected
        ? { view: 'list', table: ui.selected.table, filters: { ...ui.filters } }
        : null;
    case 'detail':
      return ui.selected && ui.detailId != null
        ? { view: 'detail', table: ui.selected.table, id: ui.detailId }
        : null;
  }
}

/** App-root-relative URL (path + query) of a route, without the mount base. */
export function routePath(route: Route): string {
  switch (route.view) {
    case 'dashboard':
      return '/';
    case 'docs':
      return '/docs';
    case 'api-keys':
      return '/api-keys';
    case 'plugin-page':
      return `/plugin/${encodeURIComponent(route.plugin)}/${encodeURIComponent(route.label)}`;
    case 'list': {
      const q = new URLSearchParams(route.filters).toString();
      return `/${encodeURIComponent(route.table)}${q ? `?${q}` : ''}`;
    }
    case 'detail':
      return `/${encodeURIComponent(route.table)}/${route.id}`;
  }
}

/** Real `href` of a route (mount base included) — for `<a>` elements. */
export function hrefFor(route: Route): string {
  return BASE + routePath(route);
}

/** The URL path (+ query) for the store's current view. */
export function pathFor(ui: UiStore): string {
  const route = routeOf(ui);
  return route ? routePath(route) : '';
}

export function parseRoute(s: string, search = ''): Route | null {
  const parts = s
    .replace(/^\/+/, '')
    .split('/')
    .map((x) => decodeURIComponent(x));
  const [head = '', a = ''] = parts;
  switch (head) {
    case '':
      return { view: 'dashboard' };
    case 'docs':
      return { view: 'docs' };
    case 'api-keys':
      return { view: 'api-keys' };
    case 'plugin': {
      const b = parts[2] ?? '';
      return a && b ? { view: 'plugin-page', plugin: a, label: b } : null;
    }
    default: {
      if (RESERVED.has(head)) return null;
      if (!a) {
        const filters = Object.fromEntries(new URLSearchParams(search));
        return Object.keys(filters).length
          ? { view: 'list', table: head, filters }
          : { view: 'list', table: head };
      }
      const id = Number(a);
      return Number.isFinite(id) ? { view: 'detail', table: head, id } : null;
    }
  }
}

/** Apply a route to the store (no-op when it doesn't resolve, e.g. unknown table). */
export function applyRoute(ui: UiStore, route: Route | null): void {
  if (!route) return;
  switch (route.view) {
    case 'dashboard':
      ui.openDashboard();
      return;
    case 'docs':
      ui.openDocs();
      return;
    case 'api-keys':
      ui.openApiKeys();
      return;
    case 'plugin-page': {
      const item = ui.pluginMenus.find(
        (p) => p.plugin === route.plugin && p.label === route.label,
      );
      if (item) ui.openPluginPage(item);
      return;
    }
    case 'list': {
      const r = ui.resources.find((x) => x.table === route.table);
      if (r) ui.openResourceFiltered(r, route.filters ?? {});
      return;
    }
    case 'detail': {
      const r = ui.resources.find((x) => x.table === route.table);
      if (r) ui.openDetail(r, route.id);
      return;
    }
  }
}

function currentRoute(): Route | null {
  const { pathname, search } = window.location;
  const p = BASE && pathname.startsWith(BASE) ? pathname.slice(BASE.length) || '/' : pathname;
  return parseRoute(p, search);
}

const currentFull = (): string => window.location.pathname + window.location.search;

/** In-app navigation depth, kept in `history.state` so it survives a refresh. */
const depth = (): number => (window.history.state as { depth?: number } | null)?.depth ?? 0;

/** True when an earlier in-app page exists in the browser history to go back to. */
export const canGoBack = (): boolean => depth() > 0;

/**
 * Wire the store to the URL, both ways.
 */
export function startRouteSync(
  ui: UiStore,
  watch: (source: () => string, cb: (v: string) => void) => void,
): void {
  // deep link on first load; normalise the URL when it didn't resolve (unknown table)
  applyRoute(ui, currentRoute());
  const clean = pathFor(ui);
  const cleanFull = clean ? BASE + clean : clean;
  if (cleanFull && cleanFull !== currentFull()) {
    window.history.replaceState({ depth: depth() }, '', cleanFull);
  }
  window.addEventListener('popstate', () => applyRoute(ui, currentRoute()));
  watch(
    () => pathFor(ui),
    (p) => {
      const full = p ? BASE + p : p;
      if (full && full !== currentFull()) {
        window.history.pushState({ depth: depth() + 1 }, '', full);
      }
    },
  );
}
