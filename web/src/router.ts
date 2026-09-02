import type { useUiStore } from './stores/ui.js';

type UiStore = ReturnType<typeof useUiStore>;

export type Route =
  | { view: 'dashboard' }
  | { view: 'docs' }
  | { view: 'api-keys' }
  | { view: 'list'; table: string }
  | { view: 'detail'; table: string; id: number }
  | { view: 'plugin-page'; plugin: string; label: string };

/** First path segments that are views of their own, never table names. */
const RESERVED = new Set(['docs', 'api-keys', 'plugin']);

/** The URL path for the store's current view. */
export function pathFor(ui: UiStore): string {
  switch (ui.view) {
    case 'dashboard':
      return '/';
    case 'docs':
      return '/docs';
    case 'api-keys':
      return '/api-keys';
    case 'plugin-page':
      return ui.pluginPage
        ? `/plugin/${encodeURIComponent(ui.pluginPage.plugin)}/${encodeURIComponent(ui.pluginPage.label)}`
        : '';
    case 'list':
      return ui.selected ? `/${encodeURIComponent(ui.selected.table)}` : '';
    case 'detail':
      return ui.selected && ui.detailId != null
        ? `/${encodeURIComponent(ui.selected.table)}/${ui.detailId}`
        : '';
  }
}

export function parseRoute(s: string): Route | null {
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
      if (!a) return { view: 'list', table: head };
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
      if (r) ui.openResource(r);
      return;
    }
    case 'detail': {
      const r = ui.resources.find((x) => x.table === route.table);
      if (r) ui.openDetail(r, route.id);
      return;
    }
  }
}

/**
 * Wire the store to the URL, both ways.
 */
export function startRouteSync(
  ui: UiStore,
  watch: (source: () => string, cb: (v: string) => void) => void,
): void {
  // deep link on first load; normalise the URL when it didn't resolve (unknown table)
  applyRoute(ui, parseRoute(window.location.pathname));
  const clean = pathFor(ui);
  if (clean && clean !== window.location.pathname) {
    window.history.replaceState(null, '', clean);
  }
  window.addEventListener('popstate', () =>
    applyRoute(ui, parseRoute(window.location.pathname)),
  );
  watch(
    () => pathFor(ui),
    (p) => {
      if (p && p !== window.location.pathname) window.history.pushState(null, '', p);
    },
  );
}
