declare global {
  interface Window {
    __PB_BASE__?: string;
  }
}

/**
 * Mount-path prefix this app is served under behind a reverse proxy (e.g. Traefik's
 * `PathPrefix('/datacenter')`), or `''` at the root.
 */
export const BASE: string = (window.__PB_BASE__ ?? '').replace(/\/+$/, '');

/** Prefix an app-root-relative path ("/api/…", "/docs", …) with the detected mount base. */
export function withBase(path: string): string {
  return path.startsWith('/') ? BASE + path : path;
}
