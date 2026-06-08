import type { Resource } from './api/resources.js';
import type { PluginMenuItem } from './api/pluginMenus.js';

/** A sidebar item is either a CRUD resource or a plugin-contributed page. */
export type NavItem = Resource | PluginMenuItem;
/** Plugin pages carry a `url`; resources don't — used to tell them apart in the sidebar. */
export const isPage = (i: NavItem): i is PluginMenuItem => 'url' in i;

// Functional sub-groups within each section (NetBox-style). A resource is placed
// in the FIRST group whose keyword is a substring of its endpoint slug, so order
// matters (most specific first). Unmatched resources fall into "Other".
interface SubGroup {
  label: string;
  match: string[];
}

const SECTION_GROUPS: Record<string, SubGroup[]> = {
  dcim: [
    { label: 'Sites', match: ['region', 'site', 'location'] },
    { label: 'Racks', match: ['rack'] },
    { label: 'Cabling', match: ['cable'] },
    { label: 'Console', match: ['console'] },
    { label: 'Power', match: ['power'] },
    { label: 'Interfaces', match: ['interface'] },
    { label: 'Ports', match: ['front-port', 'rear-port'] },
    { label: 'Modules', match: ['module'] },
    { label: 'Inventory', match: ['inventory', 'device-bay', 'mac-address'] },
    {
      label: 'Devices',
      match: ['device', 'manufacturer', 'platform', 'virtual-chassis', 'virtual-device'],
    },
  ],
  ipam: [
    { label: 'Aggregates', match: ['aggregate', 'rir'] },
    { label: 'Prefixes', match: ['prefix'] },
    { label: 'IP Addresses', match: ['ip-address', 'ip-range'] },
    { label: 'VLANs', match: ['vlan'] },
    { label: 'VRFs', match: ['vrf', 'route-target'] },
    { label: 'ASNs', match: ['asn'] },
    { label: 'Services', match: ['service'] },
    { label: 'FHRP', match: ['fhrp'] },
    { label: 'Roles', match: ['role'] },
  ],
  virtualization: [
    { label: 'Clusters', match: ['cluster'] },
    { label: 'Virtual Machines', match: ['virtual-machine', 'virtual-disk'] },
    { label: 'Interfaces', match: ['interface'] },
  ],
  tenancy: [{ label: 'Tenants', match: ['tenant'] }],
  users: [
    { label: 'Owners', match: ['owner'] },
    { label: 'Users & Groups', match: ['user', 'group'] },
  ],
  extras: [
    { label: 'Tags', match: ['tag'] },
    { label: 'Webhooks', match: ['webhook'] },
    { label: 'Config', match: ['config'] },
  ],
};

const OTHER = 'Other';

// Plugins promoted to their own top-level menu section (instead of nesting under PLUGINS).
const PROMOTED_PLUGINS = new Set(['docker']);

/** Plugin name from a /api/plugins/<name>/… endpoint. */
export function pluginNameOf(endpoint: string): string {
  return endpoint.split('/').filter(Boolean)[2] ?? '';
}

/** The section a plugin item lands in: its own top-level section if promoted, else "plugins". */
export function effectiveSection(section: string, pluginName: string): string {
  return section === 'plugins' && PROMOTED_PLUGINS.has(pluginName) ? pluginName : section;
}

// Section display order (listed sections come first, in this order) + label overrides.
const SECTION_ORDER = ['extras', 'docker', 'plugins'];
const SECTION_LABELS: Record<string, string> = { extras: 'OPERATIONS' };

export function sectionLabel(section: string): string {
  return SECTION_LABELS[section] ?? (section ? section.toUpperCase() : 'OTHER');
}

/** Lower sorts earlier; unlisted sections keep their (alphabetical) order after. */
export function sectionRank(section: string): number {
  const i = SECTION_ORDER.indexOf(section);
  return i === -1 ? SECTION_ORDER.length : i;
}

export function resourceSlug(r: Resource): string {
  return r.endpoint.split('/').filter(Boolean).pop() ?? r.table;
}

const titleize = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Plugin display name from a /api/plugins/<name>/<resource>/ endpoint. */
function pluginLabel(r: Resource): string {
  const name = r.endpoint.split('/').filter(Boolean)[2]; // ["api","plugins",<name>,<resource>]
  return name ? titleize(name) : 'Plugin';
}

function subgroupOf(section: string, slug: string): string {
  const cfg = SECTION_GROUPS[section];
  if (!cfg) return '';
  for (const g of cfg) if (g.match.some((kw) => slug.includes(kw))) return g.label;
  return OTHER;
}

export interface SubGroupView {
  label: string;
  items: NavItem[];
}

/** Bucket a section's resources (and, for plugins, contributed pages) into sub-groups. */
export function subgroupsFor(
  section: string,
  resources: Resource[],
  pages: PluginMenuItem[] = [],
): SubGroupView[] {
  // Plugins: one sub-group per loaded plugin (by name), so several can coexist. A plugin's
  // contributed pages (Visualization, Docs, …) appear in its own group, after its CRUD items.
  if (section === 'plugins') {
    const byPlugin = new Map<string, NavItem[]>();
    for (const r of resources) {
      const label = pluginLabel(r);
      (byPlugin.get(label) ?? byPlugin.set(label, []).get(label)!).push(r);
    }
    for (const p of pages) {
      const label = titleize(p.plugin);
      (byPlugin.get(label) ?? byPlugin.set(label, []).get(label)!).push(p);
    }
    return [...byPlugin.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, items]) => ({
      label,
      items: items.sort((a, b) => {
        const pa = isPage(a) ? 1 : 0,
          pb = isPage(b) ? 1 : 0;
        if (pa !== pb) return pa - pb; // CRUD resources first, then pages
        if (isPage(a) || isPage(b)) return a.label.localeCompare(b.label);
        return a.order - b.order || a.label.localeCompare(b.label);
      }),
    }));
  }

  const cfg = SECTION_GROUPS[section];
  const byLabel = new Map<string, NavItem[]>();
  for (const r of resources) {
    const label = subgroupOf(section, resourceSlug(r));
    (byLabel.get(label) ?? byLabel.set(label, []).get(label)!).push(r);
  }
  // promoted single-plugin sections (e.g. DOCKER) also carry their contributed pages
  for (const p of pages) (byLabel.get('') ?? byLabel.set('', []).get('')!).push(p);
  const order = cfg ? [...cfg.map((g) => g.label), OTHER] : [''];
  return order
    .filter((l) => byLabel.has(l))
    .map((label) => ({
      label,
      items: byLabel.get(label)!.sort((a, b) => {
        const pa = isPage(a) ? 1 : 0,
          pb = isPage(b) ? 1 : 0;
        if (pa !== pb) return pa - pb; // CRUD resources first, then pages
        if (isPage(a) || isPage(b)) return a.label.localeCompare(b.label);
        return a.order - b.order || a.label.localeCompare(b.label); // creation order
      }),
    }));
}
