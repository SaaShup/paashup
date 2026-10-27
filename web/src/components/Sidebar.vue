<script setup lang="ts">
import { watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import type { Route } from '../router.js';
import RouteLink from './RouteLink.vue';
import { sectionLabel, isPage, type NavItem } from '../groups.js';

const ui = useUiStore();

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
const itemRoute = (it: NavItem): Route =>
  isPage(it)
    ? { view: 'plugin-page', plugin: it.plugin, label: it.label }
    : { view: 'list', table: it.table };

const sectionOpen = (s: string) => !!ui.expandedSections[s];
const groupOpen = (section: string, label: string) => !!ui.expandedGroups[`${section}::${label}`];
</script>

<template>
  <aside class="sidebar">
    <RouteLink
      class="nav-item top"
      :class="{ active: ui.view === 'dashboard' }"
      :to="{ view: 'dashboard' }"
    >
      <span class="ico">▦</span> Dashboard
    </RouteLink>
    <RouteLink class="nav-item top" :class="{ active: ui.view === 'docs' }" :to="{ view: 'docs' }">
      <span class="ico">📖</span> Docs
    </RouteLink>
    <RouteLink
      class="nav-item top"
      :class="{ active: ui.view === 'api-keys' }"
      :to="{ view: 'api-keys' }"
    >
      <span class="ico">🔑</span> API keys
    </RouteLink>

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
            <RouteLink
              v-for="it in g.items"
              v-show="groupOpen(sec.section, g.label)"
              :key="itemKey(it)"
              class="nav-item deep"
              :class="{ active: pageActive(it) || resActive(it) }"
              :to="itemRoute(it)"
            >
              <span v-if="isPage(it)" class="ico sm">{{ pageIcon(it) }}</span>
              <span class="label">{{ it.label }}</span>
              <span v-if="countOf(it) !== null" class="count">{{ countOf(it) }}</span>
            </RouteLink>
          </template>
          <!-- section without sub-groups: items directly -->
          <template v-else>
            <RouteLink
              v-for="it in g.items"
              :key="itemKey(it)"
              class="nav-item"
              :class="{ active: pageActive(it) || resActive(it) }"
              :to="itemRoute(it)"
            >
              <span v-if="isPage(it)" class="ico sm">{{ pageIcon(it) }}</span>
              <span class="label">{{ it.label }}</span>
              <span v-if="countOf(it) !== null" class="count">{{ countOf(it) }}</span>
            </RouteLink>
          </template>
        </template>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  background: #fff;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 14px 10px 40px;
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
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 10px 10px 6px;
  border-radius: 8px;
}
.group-head:hover {
  color: var(--text);
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
  background: var(--surface);
  color: var(--muted);
  border-radius: 999px;
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
  color: var(--primary);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 6px 10px 6px 22px;
  border-radius: 8px;
}
.subhead:hover {
  background: var(--surface);
}
.nav-item {
  text-decoration: none;
  display: flex;
  align-items: center;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  position: relative;
  color: var(--text);
  padding: 6px 12px 6px 26px;
  margin: 1px 0;
  border-radius: 8px;
  font-size: 0.88rem;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
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
}
.nav-item.active .count {
  background: #fff;
  color: var(--primary-d);
}
.nav-item.deep {
  padding-left: 38px;
}
.nav-item.top {
  padding-left: 12px;
  font-weight: 550;
  margin-bottom: 2px;
}
.nav-item:hover {
  background: var(--surface);
}
.nav-item.active {
  background: var(--primary-soft);
  color: var(--primary-d);
  font-weight: 600;
}
/* accent bar on the active row */
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 3px;
  background: var(--primary);
}
.ico {
  margin-right: 6px;
}
</style>
