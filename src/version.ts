// Single source of truth for version strings.
//  - NETBOX_VERSION: the NetBox REST API version paashup targets for compatibility.
//    Used in the OpenAPI doc (`info.version`) and the `/api/status/` endpoint so NetBox
//    clients can gate behavior on it.
//  - appVersion(): paashup's own product version, read from package.json at runtime.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** NetBox REST API version paashup mirrors. */
export const NETBOX_VERSION = '4.6.2';

let cached: string | undefined;

/**
 * paashup product version from package.json. Returns "unknown" if it can't be read.
 * `pkgUrl` is an injectable override for tests (bypasses the cache).
 */
export function appVersion(pkgUrl?: URL): string {
  if (!pkgUrl && cached !== undefined) return cached;
  let version: string;
  try {
    // dist/version.js → ../package.json = project root; cwd-independent.
    const url = pkgUrl ?? new URL('../package.json', import.meta.url);
    const v = (JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as { version?: unknown })
      .version;
    version = typeof v === 'string' && v ? v : 'unknown';
  } catch {
    version = 'unknown';
  }
  if (!pkgUrl) cached = version;
  return version;
}
