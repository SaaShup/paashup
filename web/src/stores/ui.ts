import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import type { Resource } from '../api/resources.js';
import type { PluginMenuItem } from '../api/pluginMenus.js';
import type { ChangeEvent } from '../websocket/events.js';
import {
  subgroupsFor,
  sectionRank,
  effectiveSection,
  isHiddenSection,
  isHiddenResource,
  sectionOf,
  type SubGroupView,
} from '../groups.js';

/** Core tables the OpenStack sync writes to (their counts/lists must be refreshed after it). */
export const OPENSTACK_SYNCED_TABLES = [
  'virtualization_cluster_type',
  'virtualization_cluster',
  'virtualization_virtual_machine_type',
  'virtualization_virtual_machine',
  'virtualization_vminterface',
  'virtualization_virtual_disk',
  'ipam_ipaddress',
  'dcim_region',
  'dcim_site',
  'virtualization_image',
  'virtualization_ssh_key',
];

/**
 * Tables whose content changed behind the change-feed's back: the OpenStack sync writes
 * VMs, clusters, IPs... with plain SQL, so no per-row events exist. The cloud's own
 * events tell us when it finished (state connected/error) or was removed.
 */
export function bulkChangedTables(e: ChangeEvent): string[] {
  if (e.table !== 'plugin_openstack_cloud') return [];
  const raw = (e.data as { state?: unknown } | undefined)?.state;
  const state = typeof raw === 'object' && raw ? (raw as { value?: unknown }).value : raw;
  const finished = e.event === 'updated' && (state === 'connected' || state === 'error');
  return finished || e.event === 'deleted' ? OPENSTACK_SYNCED_TABLES : [];
}

/** UI navigation state: which view is shown, the resource catalog, group collapse. */
export const useUiStore = defineStore('ui', {
  state: () => ({
    resources: [] as Resource[],
    /** Plugin-contributed sidebar entries (each opens a plugin page in a frame). */
    pluginMenus: [] as PluginMenuItem[],
    pluginPage: null as PluginMenuItem | null,
    view: 'dashboard' as 'dashboard' | 'list' | 'detail' | 'docs' | 'plugin-page' | 'api-keys',
    selected: null as Resource | null,
    /** Object id being shown in the read-only detail view (with `selected` as its resource). */
    detailId: null as number | null,
    /** Column filters of the list view (part of the URL query string). */
    filters: {} as Record<string, string>,
    // accordion: everything collapsed by default; user expands by clicking.
    expandedSections: {} as Record<string, boolean>,
    expandedGroups: {} as Record<string, boolean>,
    search: '',
    /** Record count per table (sidebar item badges); kept live via the change-feed. */
    counts: {} as Record<string, number>,
  }),
  getters: {
    /** Sections → functional sub-groups → resources, filtered by the top-bar search. */
    grouped(state): { section: string; groups: SubGroupView[] }[] {
      const q = state.search.trim().toLowerCase();
      const by = new Map<string, Resource[]>();
      for (const r of state.resources) {
        if (isHiddenSection(r.section) || isHiddenResource(r)) continue; // e.g. vpn, wireless, most of dcim
        if (q && !`${r.section} ${r.label} ${r.table}`.toLowerCase().includes(q)) continue;
        // promote configured plugins (e.g. docker) to their own top-level section
        const sec = sectionOf(r);
        (by.get(sec) ?? by.set(sec, []).get(sec)!).push(r);
      }
      // plugin-contributed pages, bucketed by their (possibly promoted) section
      const pagesBySection = new Map<string, typeof state.pluginMenus>();
      for (const p of state.pluginMenus) {
        if (q && !`${p.plugin} ${p.label}`.toLowerCase().includes(q)) continue;
        const sec = effectiveSection('plugins', p.plugin);
        (pagesBySection.get(sec) ?? pagesBySection.set(sec, []).get(sec)!).push(p);
        if (!by.has(sec)) by.set(sec, []);
      }
      return [...by.entries()]
        .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]) || a[0].localeCompare(b[0]))
        .map(([section, items]) => ({
          section,
          groups: subgroupsFor(section, items, pagesBySection.get(section) ?? []),
        }));
    },
  },
  actions: {
    setResources(resources: Resource[]) {
      this.resources = resources;
    },
    setPluginMenus(items: PluginMenuItem[]) {
      this.pluginMenus = items;
    },
    openPluginPage(item: PluginMenuItem) {
      this.view = 'plugin-page';
      this.pluginPage = item;
      this.selected = null;
    },
    openDashboard() {
      this.view = 'dashboard';
      this.selected = null;
    },
    openDocs() {
      this.view = 'docs';
      this.selected = null;
    },
    openApiKeys() {
      this.view = 'api-keys';
      this.selected = null;
    },
    openResource(r: Resource) {
      this.view = 'list';
      this.selected = r;
      this.detailId = null;
      this.filters = {};
    },
    /** Open the read-only detail view for one object of resource `r`. */
    openDetail(r: Resource, id: number) {
      this.view = 'detail';
      this.selected = r;
      this.detailId = id;
    },
    /** Open resource `r`'s list with `filters` pre-applied (e.g. a host's containers). */
    openResourceFiltered(r: Resource, filters: Record<string, string>) {
      this.openResource(r);
      this.filters = filters;
    },
    toggleSection(section: string) {
      this.expandedSections[section] = !this.expandedSections[section];
    },
    toggleGroup(section: string, label: string) {
      const key = `${section}::${label}`;
      this.expandedGroups[key] = !this.expandedGroups[key];
    },
    /**
     * Fetch the record count for each resource (via `?limit=1` → `page.count`), skipping
     * tables already counted. Limited concurrency; failures leave a table uncounted.
     * Shared by the sidebar item badges and the dashboard usage cards.
     */
    async loadCounts(resources: Resource[], force = false) {
      const todo = force ? resources : resources.filter((r) => !(r.table in this.counts));
      if (!todo.length) return;
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          const r = todo[i++]!;
          try {
            const page = await api.list(r.endpoint, { limit: 1 });
            this.counts[r.table] = page.count;
          } catch {
            /* leave uncounted on error */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker));
    },
    /** Live-adjust a table's count from a change-feed event (no-op if not yet counted). */
    bumpCount(e: ChangeEvent) {
      if (!(e.table in this.counts)) return;
      if (e.event === 'created') this.counts[e.table] += 1;
      else if (e.event === 'deleted') this.counts[e.table] = Math.max(0, this.counts[e.table] - 1);
    },
    /**
     * A Docker host refresh or an OpenStack sync changes many rows at once without
     * per-row events: re-fetch the real counts of the affected tables.
     */
    resyncCountsAfterBulkChange(e: ChangeEvent): Promise<void> | undefined {
      const synced = bulkChangedTables(e);
      if (synced.length) {
        return this.loadCounts(
          this.resources.filter((r) => synced.includes(r.table)),
          true,
        );
      }
      if (e.table !== 'plugin_docker_host') return;
      const refreshing =
        e.event === 'updated' &&
        (e.data as { state?: unknown } | undefined)?.state === 'refreshing';
      if (!refreshing && e.event !== 'deleted') return;
      const affected = this.resources.filter(
        (r) => r.table.startsWith('plugin_docker_') && r.table !== 'plugin_docker_host',
      );
      return this.loadCounts(affected, true);
    },
  },
});
