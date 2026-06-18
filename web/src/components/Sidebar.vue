<script setup lang="ts">
import { computed, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { sectionLabel, isPage, type NavItem } from '../groups.js';

const ui = useUiStore();
const searchActive = computed(() => ui.search.trim() !== '');

// Per-resource record counts shown as item badges — fetched once the catalog is
// available (shared with the dashboard via the store; kept live by the change-feed).
watch(
  () => ui.resources.length,
  (n) => {
    if (n) ui.loadCounts(ui.resources);
  },
  { immediate: true },
);
const fmt = (n: number) => n.toLocaleString();
/** Formatted record count for a resource item, or null (pages, or not yet known). */
const countOf = (it: NavItem): string | null => {
  if (isPage(it)) return null;
  const c = ui.counts[it.table];
  return c === undefined ? null : fmt(c);
};
/** Stable key for a sidebar item (pages by url, resources by table). */
const itemKey = (it: NavItem) => (isPage(it) ? `page:${it.url}` : `res:${it.table}`);
const pageActive = (it: NavItem) =>
  isPage(it) && ui.view === 'plugin-page' && ui.pluginPage?.url === it.url;
const resActive = (it: NavItem) => !isPage(it) && ui.selected?.table === it.table;
const pageIcon = (it: NavItem) => (isPage(it) ? it.icon || '🧩' : '🧩');
const openItem = (it: NavItem) => (isPage(it) ? ui.openPluginPage(it) : ui.openResource(it));

// While searching, force everything open so matches are visible.
const sectionOpen = (s: string) => searchActive.value || !!ui.expandedSections[s];
const groupOpen = (section: string, label: string) =>
  searchActive.value || !!ui.expandedGroups[`${section}::${label}`];
</script>

<template>
  <aside class="sidebar">
    <button
      class="nav-item top"
      :class="{ active: ui.view === 'dashboard' }"
      @click="ui.openDashboard()"
    >
      <span class="ico">▦</span> Dashboard
    </button>
    <button class="nav-item top" :class="{ active: ui.view === 'docs' }" @click="ui.openDocs()">
      <span class="ico">📖</span> Docs
    </button>
    <button
      class="nav-item top"
      :class="{ active: ui.view === 'api-keys' }"
      @click="ui.openApiKeys()"
    >
      <span class="ico">🔑</span> API keys
    </button>

    <div v-for="sec in ui.grouped" :key="sec.section" class="group">
      <button class="group-head" @click="ui.toggleSection(sec.section)">
        <span class="caret">{{ sectionOpen(sec.section) ? '▾' : '▸' }}</span>
        {{ sectionLabel(sec.section) }}
      </button>

      <div v-show="sectionOpen(sec.section)" class="links">
        <template v-for="g in sec.groups" :key="g.label">
          <!-- functional sub-group: collapsible header -->
          <template v-if="g.label">
            <button class="subhead" @click="ui.toggleGroup(sec.section, g.label)">
              <span class="caret sm">{{ groupOpen(sec.section, g.label) ? '▾' : '▸' }}</span>
              {{ g.label }}
            </button>
            <button
              v-for="it in g.items"
              v-show="groupOpen(sec.section, g.label)"
              :key="itemKey(it)"
              class="nav-item deep"
              :class="{ active: pageActive(it) || resActive(it) }"
              @click="openItem(it)"
            >
              <span v-if="isPage(it)" class="ico sm">{{ pageIcon(it) }}</span>
              <span class="label">{{ it.label }}</span>
              <span v-if="countOf(it) !== null" class="count">{{ countOf(it) }}</span>
            </button>
          </template>
          <!-- section without sub-groups: items directly -->
          <template v-else>
            <button
              v-for="it in g.items"
              :key="itemKey(it)"
              class="nav-item"
              :class="{ active: pageActive(it) || resActive(it) }"
              @click="openItem(it)"
            >
              <span v-if="isPage(it)" class="ico sm">{{ pageIcon(it) }}</span>
              <span class="label">{{ it.label }}</span>
              <span v-if="countOf(it) !== null" class="count">{{ countOf(it) }}</span>
            </button>
          </template>
        </template>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 10px 8px 40px;
}
.group {
  margin-top: 2px;
}
.group-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 8px 10px;
  border-radius: 6px;
}
.group-head:hover {
  background: var(--surface-2);
}
.caret {
  width: 10px;
  color: var(--muted);
}
.caret.sm {
  font-size: 0.7rem;
}
.count {
  margin-left: auto;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--primary-d);
  border-radius: 10px;
  padding: 0 7px;
  font-size: 0.72rem;
}
.links {
  display: flex;
  flex-direction: column;
}
.subhead {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--secondary);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 6px 10px 6px 22px;
  border-radius: 6px;
}
.subhead:hover {
  background: var(--surface-2);
}
.nav-item {
  display: flex;
  align-items: center;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text);
  padding: 6px 12px 6px 26px;
  border-radius: 6px;
  font-size: 0.88rem;
}
/* label truncates so a long name never pushes the badge off-row */
.nav-item .label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* record-count badge sits on the right; muted, and inverted on the active row */
.nav-item .count {
  flex: none;
  font-size: 0.7rem;
  background: var(--surface-2);
}
.nav-item.active .count {
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
}
.nav-item.deep {
  padding-left: 38px;
}
.nav-item.top {
  padding-left: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.nav-item:hover {
  background: var(--surface-2);
}
.nav-item.active {
  background: var(--primary);
  color: #fff;
}
.ico {
  margin-right: 6px;
}
</style>
