import { defineStore } from 'pinia';
import type { Resource } from '../api/resources.js';
import { subgroupsFor, sectionRank, type SubGroupView } from '../groups.js';

/** UI navigation state: which view is shown, the resource catalog, group collapse. */
export const useUiStore = defineStore('ui', {
  state: () => ({
    resources: [] as Resource[],
    view: 'dashboard' as 'dashboard' | 'list',
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
        if (q && !`${r.section} ${r.label} ${r.table}`.toLowerCase().includes(q)) continue;
        (by.get(r.section) ?? by.set(r.section, []).get(r.section)!).push(r);
      }
      return [...by.entries()]
        .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]) || a[0].localeCompare(b[0]))
        .map(([section, items]) => ({ section, groups: subgroupsFor(section, items) }));
    },
  },
  actions: {
    setResources(resources: Resource[]) {
      this.resources = resources;
    },
    openDashboard() {
      this.view = 'dashboard';
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
