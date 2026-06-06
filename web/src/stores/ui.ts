import { defineStore } from 'pinia';
import type { Resource } from '../api/resources.js';

/** UI navigation state: which view is shown, the resource catalog, group collapse. */
export const useUiStore = defineStore('ui', {
  state: () => ({
    resources: [] as Resource[],
    view: 'dashboard' as 'dashboard' | 'list',
    selected: null as Resource | null,
    collapsed: {} as Record<string, boolean>,
    search: '',
  }),
  getters: {
    /** resources grouped by section, filtered by the top-bar search. */
    grouped(state): [string, Resource[]][] {
      const q = state.search.trim().toLowerCase();
      const by = new Map<string, Resource[]>();
      for (const r of state.resources) {
        if (q && !`${r.section} ${r.label} ${r.table}`.toLowerCase().includes(q)) continue;
        (by.get(r.section) ?? by.set(r.section, []).get(r.section)!).push(r);
      }
      return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
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
    toggleGroup(section: string) {
      this.collapsed[section] = !this.collapsed[section];
    },
  },
});
