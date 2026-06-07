import type { Resource } from './api/resources.js';

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
    { label: 'Config', match: ['config'] },
  ],
};

const OTHER = 'Other';

export function resourceSlug(r: Resource): string {
  return r.endpoint.split('/').filter(Boolean).pop() ?? r.table;
}

function subgroupOf(section: string, slug: string): string {
  const cfg = SECTION_GROUPS[section];
  if (!cfg) return '';
  for (const g of cfg) if (g.match.some((kw) => slug.includes(kw))) return g.label;
  return OTHER;
}

export interface SubGroupView {
  label: string;
  items: Resource[];
}

/** Bucket a section's resources into ordered functional sub-groups. */
export function subgroupsFor(section: string, resources: Resource[]): SubGroupView[] {
  const cfg = SECTION_GROUPS[section];
  const byLabel = new Map<string, Resource[]>();
  for (const r of resources) {
    const label = subgroupOf(section, resourceSlug(r));
    (byLabel.get(label) ?? byLabel.set(label, []).get(label)!).push(r);
  }
  const order = cfg ? [...cfg.map((g) => g.label), OTHER] : [''];
  return order
    .filter((l) => byLabel.has(l))
    .map((label) => ({
      label,
      items: byLabel.get(label)!.sort((a, b) => a.label.localeCompare(b.label)),
    }));
}
