import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Discover plugin module specifiers from the project's package.json:
 *   - `paas2box.plugins`: an explicit array of module specifiers, and/or
 *   - any dependency named `paas2box-plugin-*` (convention).
 * Combine with the `PB_PLUGINS` env list in your entry point.
 */
export function discoverPluginSpecifiers(rootDir: string = process.cwd()): string[] {
  let pkg: {
    paas2box?: { plugins?: unknown };
    dependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const out = new Set<string>();
  const explicit = pkg.paas2box?.plugins;
  if (Array.isArray(explicit)) {
    for (const s of explicit) if (typeof s === 'string') out.add(s);
  }
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep.startsWith('paas2box-plugin-')) out.add(dep);
  }
  return [...out];
}
