// Generic plugin-contributed sidebar entries. A plugin may expose
// `GET /api/plugins/<name>/ui/` returning `{ menu: [{ label, url, icon? }] }`; each item
// becomes a sidebar entry that opens the plugin's own page (an embedded frame). The page
// itself is shipped + served by the plugin — paashup only renders the entry and frame.
import { api } from './client.js';
import type { Resource } from './resources.js';

export interface PluginMenuItem {
  plugin: string;
  label: string;
  url: string;
  icon?: string;
  /** Sidebar placement (lower = earlier). Sorted alongside CRUD resources' order;
   *  omit to fall after the section's resources (legacy behavior). */
  order?: number;
}

interface UiManifest {
  menu?: { label: string; url: string; icon?: string; order?: number }[];
}

/** Probe every loaded plugin (from the resource catalog) for a `…/ui/` menu manifest. */
export async function discoverPluginMenus(resources: Resource[]): Promise<PluginMenuItem[]> {
  const names = new Set<string>();
  for (const r of resources) {
    const p = r.endpoint.split('/').filter(Boolean); // ["api","plugins",<name>,<res>]
    if (p[0] === 'api' && p[1] === 'plugins' && p[2]) names.add(p[2]);
  }
  // Also include plugins that ship a UI but no entities (e.g. netbox-migrate).
  try {
    const loaded = await api.get<{ results?: { name: string }[] }>('/api/plugins/');
    for (const pl of loaded.results ?? []) if (pl.name) names.add(pl.name);
  } catch {
    /* endpoint absent (older backend) — fall back to resource-derived names */
  }
  const out: PluginMenuItem[] = [];
  await Promise.all(
    [...names].map(async (name) => {
      try {
        const m = await api.get<UiManifest>(`/api/plugins/${name}/ui/`);
        for (const it of m.menu ?? []) {
          if (it?.label && it?.url)
            out.push({
              plugin: name,
              label: it.label,
              url: it.url,
              icon: it.icon,
              order: it.order,
            });
        }
      } catch {
        /* plugin has no /ui/ manifest */
      }
    }),
  );
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
