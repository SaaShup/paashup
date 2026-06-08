import { defineStore } from 'pinia';
import type { Resource } from '../api/resources.js';
import type { PluginMenuItem } from '../api/pluginMenus.js';
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
    view: 'dashboard' as 'dashboard' | 'list' | 'docs' | 'plugin-page',
    selected: null as Resource | null,
    // accordion: everything collapsed by default; user expands by clicking.
    expandedSections: {} as Record<string, boolean>,
    expandedGroups: {} as Record<string, boolean>,
    search: '',
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
          r.section === 'plugins' ? effectiveSection(r.section, pluginNameOf(r.endpoint)) : r.section;
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
    openResource(r: Resource) {
      this.view = 'list';
      this.selected = r;
    },
    toggleSection(section: string) {
      this.expandedSections[section] = !this.expandedSections[section];
    },
    toggleGroup(section: string, label: string) {
      const key = `${section}::${label}`;
      this.expandedGroups[key] = !this.expandedGroups[key];
    },
  },
});
