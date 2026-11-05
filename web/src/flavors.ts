// OpenStack flavors, grouped by family so a long list can be browsed instead of scrolled
// through flat. Flavors are named "<family><generation>-<size>" (b2-7, d2-2, win-c3-8…); the
// families below are OVHcloud's, any other name (m1.small…) is grouped by its prefix, and what
// has none goes under "Other". Shared by the "Add VM" form and the VM resize popup.
export interface Flavor {
  id: string;
  name: string;
  vcpus: number;
  ram: number;
  disk: number;
}

const FAMILIES: Record<string, string> = {
  d: 'Discovery',
  b: 'General purpose',
  c: 'CPU optimised',
  r: 'RAM optimised',
  i: 'IOPS',
  t: 'GPU',
};

const familyOf = (flavor: string): string =>
  flavor.match(/^((?:win-)?[a-z]+\d*)[-.]/i)?.[1]?.toLowerCase() ?? '';

function familyLabel(code: string): string {
  if (!code) return 'Other';
  const windows = code.startsWith('win-');
  const base = windows ? code.slice(4) : code;
  const name = FAMILIES[base[0] ?? ''];
  return `${windows ? 'Windows — ' : ''}${name ? `${name} (${base})` : base}`;
}

/** Flavors grouped by family, families in a fixed order, flavors within a group by size. */
export function flavorGroups(flavors: Flavor[]): { label: string; items: Flavor[] }[] {
  const byFamily = new Map<string, Flavor[]>();
  for (const f of flavors) {
    const code = familyOf(f.name);
    byFamily.set(code, [...(byFamily.get(code) ?? []), f]);
  }
  const rank = (code: string): number => {
    const i = Object.keys(FAMILIES).indexOf((code.replace('win-', '')[0] ?? '') as string);
    return (code.startsWith('win-') ? 100 : 0) + (code ? (i < 0 ? 50 : i) : 99);
  };
  return [...byFamily.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([code, items]) => ({
      label: familyLabel(code),
      items: [...items].sort((a, b) => a.vcpus - b.vcpus || a.ram - b.ram),
    }));
}

export const flavorLabel = (f: Flavor): string =>
  `${f.name} — ${f.vcpus} vCPU · ${Math.round((f.ram / 1024) * 10) / 10} GB RAM · ${f.disk} GB disk`;
