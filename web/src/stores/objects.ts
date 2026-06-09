import { defineStore } from 'pinia';
import { api, type Obj } from '../api/client.js';
import type { ChangeEvent } from '../websocket/events.js';

interface TableState {
  endpoint: string;
  items: Obj[];
  count: number;
  loading: boolean;
}

const idOf = (o: Obj): number => (o as { id: number }).id;

/**
 * Holds loaded records per table and keeps them live: `load()` fetches a page via
 * REST; `applyChange()` patches the in-memory list from a WebSocket change event.
 */
export const useObjectsStore = defineStore('objects', {
  state: () => ({
    byTable: {} as Record<string, TableState>,
  }),
  actions: {
    async load(table: string, endpoint: string, params?: Record<string, string | number>) {
      // NB: read the slot back through `this.byTable` so we mutate the *reactive*
      // proxy, not the raw literal. `x ??= {…}` evaluates to the raw object, and
      // mutating that bypasses Vue's reactivity (the view would stay stuck loading).
      this.byTable[table] ??= { endpoint, items: [], count: 0, loading: false };
      const slot = this.byTable[table]!;
      slot.endpoint = endpoint;
      slot.loading = true;
      try {
        const page = await api.list(endpoint, params);
        slot.items = page.results;
        slot.count = page.count;
      } finally {
        slot.loading = false;
      }
    },

    async remove(table: string, id: number) {
      const slot = this.byTable[table];
      if (slot) await api.remove(slot.endpoint, id);
      // the resulting WebSocket 'deleted' event removes the row via applyChange()
    },

    /** Apply a live change to a currently-loaded table (no-op otherwise). */
    applyChange(e: ChangeEvent) {
      const slot = this.byTable[e.table];
      if (!slot) return;
      const idx = slot.items.findIndex((o) => idOf(o) === e.id);
      if (e.event === 'deleted') {
        if (idx >= 0) {
          slot.items.splice(idx, 1);
          slot.count -= 1;
        }
      } else if (e.data) {
        if (idx >= 0) slot.items[idx] = e.data;
        else {
          slot.items.unshift(e.data);
          slot.count += 1;
        }
      }
    },
  },
});
