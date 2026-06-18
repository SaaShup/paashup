import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import type { Resource } from '../api/resources.js';
import type { PluginMenuItem } from '../api/pluginMenus.js';
import type { ChangeEvent } from '../websocket/events.js';
import {
  subgroupsFor,
  sectionRank,
  effectiveSection,
  pluginNameOf,
  isHiddenSection,
  type SubGroupView,
} from '../groups.js';

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
    /** One-shot column filters applied by the next list view it opens (then cleared). */
    pendingFilters: null as Record<string, string> | null,
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
        if (isHiddenSection(r.section)) continue; // e.g. vpn, wireless
        if (q && !`${r.section} ${r.label} ${r.table}`.toLowerCase().includes(q)) continue;
        // promote configured plugins (e.g. docker) to their own top-level section
        const sec =
          r.section === 'plugins'
            ? effectiveSection(r.section, pluginNameOf(r.endpoint))
            : r.section;
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
      this.pendingFilters = filters;
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
  },
});
