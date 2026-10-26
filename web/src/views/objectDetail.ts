// Config for the generic object detail page (ObjectDetailView): which tables have one and
// which related lists each shows. Framework-free so it can be unit-tested.
import { api, type Obj } from '../api/client.js';
import type { Resource } from '../api/resources.js';

export interface RelatedSection {
  title: string;
  /** Table of the rows (its resource gives the endpoint; the section is skipped if unknown). */
  table: string;
  empty: string;
  /** Load the rows of this section for the opened object. */
  load: (endpoint: string, id: number, obj: Obj) => Promise<Obj[]>;
}

export interface DetailConfig {
  /** Row fields never shown in the header (secrets, noise). */
  hide?: string[];
  sections: RelatedSection[];
  /** PATCH {operation:'refresh'} button (OpenStack cloud). */
  refresh?: boolean;
  /** Show the cloud's per-region synchronisation status. */
  regionStatus?: boolean;
  /** Show the object's `content` as a terminal, with the script's variables (init script). */
  script?: boolean;
}

const byFk = (param: string) => async (endpoint: string, id: number) =>
  (await api.list(endpoint, { [param]: id, limit: 500 })).results;

const VMS = (param: string, title = 'Virtual machines'): RelatedSection => ({
  title,
  table: 'virtualization_virtual_machine',
  empty: 'No virtual machines',
  load: byFk(param),
});

export const DETAIL: Record<string, DetailConfig> = {
  virtualization_virtual_machine: {
    sections: [
      {
        title: 'Docker host',
        table: 'plugin_docker_host',
        empty: 'No Docker host is linked to this VM',
        load: byFk('virtual_machine_id'),
      },
      {
        title: 'Interfaces',
        table: 'virtualization_vminterface',
        empty: 'No interfaces',
        load: byFk('virtual_machine_id'),
      },
      {
        title: 'IP addresses',
        table: 'ipam_ipaddress',
        empty: 'No IP addresses',
        // addresses hang off the VM's interfaces: read each interface's own
        load: async (endpoint, id) => {
          const ifaces = (
            await api.list('/api/virtualization/interfaces/', {
              virtual_machine_id: id,
              limit: 200,
            })
          ).results;
          const pages = await Promise.all(
            ifaces.map((i) =>
              api.list(endpoint, {
                assigned_object_type: 'virtualization.vminterface',
                assigned_object_id: (i as { id: number }).id,
                limit: 200,
              }),
            ),
          );
          return pages.flatMap((p) => p.results);
        },
      },
      {
        title: 'Volumes',
        table: 'virtualization_virtual_disk',
        empty: 'No volumes',
        load: byFk('virtual_machine_id'),
      },
      {
        // what was done to the VM through paasbox (e.g. the SSH key it was launched with)
        title: 'Journal',
        table: 'extras_journalentry',
        empty: 'No journal entries',
        load: async (endpoint, id) =>
          (
            await api.list(endpoint, {
              assigned_object_type: 'virtualization.virtualmachine',
              assigned_object_id: id,
              ordering: '-id',
              limit: 20,
            })
          ).results,
      },
    ],
  },
  dcim_region: {
    sections: [
      {
        title: 'Sites',
        table: 'dcim_site',
        empty: 'No sites',
        load: byFk('region_id'),
      },
      {
        title: 'Virtual machines',
        table: 'virtualization_virtual_machine',
        empty: 'No virtual machines',
        // a region holds sites; the VMs sit on those sites
        load: async (endpoint, id) => {
          const sites = (await api.list('/api/dcim/sites/', { region_id: id, limit: 500 })).results;
          const pages = await Promise.all(
            sites.map((s) => api.list(endpoint, { site_id: (s as { id: number }).id, limit: 500 })),
          );
          return pages.flatMap((p) => p.results);
        },
      },
    ],
  },
  dcim_site: { sections: [VMS('site_id')] },
  virtualization_cluster: { sections: [VMS('cluster_id')] },
  virtualization_virtual_machine_type: { sections: [VMS('virtual_machine_type_id')] },
  virtualization_image: { sections: [VMS('image_id')] },
  // the VMs it is on: a section of its own (SshKeyDeployments), to deploy / remove it
  virtualization_ssh_key: { sections: [] },
  virtualization_init_script: {
    hide: ['content', 'variables', 'featured_variables'],
    script: true,
    sections: [],
  },
  plugin_openstack_cloud: {
    hide: ['password'],
    refresh: true,
    regionStatus: true,
    sections: [
      {
        title: 'Journal',
        table: 'extras_journalentry',
        empty: 'No journal entries',
        load: async (endpoint, id) =>
          (
            await api.list(endpoint, {
              assigned_object_type: 'plugins.openstackcloud',
              assigned_object_id: id,
              ordering: '-id',
              limit: 20,
            })
          ).results,
      },
    ],
  },
};

/** Tables whose rows open an object detail page (the Docker host has its own view). */
export const DETAIL_TABLES = new Set(Object.keys(DETAIL));
/** Tables a link may point to: the generic detail pages plus the Docker host detail. */
export const LINKABLE_TABLES = new Set([...DETAIL_TABLES, 'plugin_docker_host']);

/** The resource a nested brief (`{id, url, display}`) points to, if it has a detail page. */
export function briefTarget(
  value: unknown,
  resources: readonly Resource[],
): { table: string; id: number } | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as { id?: unknown; url?: unknown };
  if (typeof o.id !== 'number' || typeof o.url !== 'string') return null;
  let path: string;
  try {
    path = new URL(o.url, 'http://x').pathname; // briefs may carry a relative url
  } catch {
    return null;
  }
  const r = resources.find((x) => path.includes(x.endpoint));
  return r && LINKABLE_TABLES.has(r.table) ? { table: r.table, id: o.id } : null;
}
