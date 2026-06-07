<script setup lang="ts">
import { useUiStore } from '../stores/ui.js';

const ui = useUiStore();
const sectionLabel = (s: string) => (s ? s.toUpperCase() : 'OTHER');
</script>

<template>
  <aside class="sidebar">
    <button class="nav-item top" :class="{ active: ui.view === 'dashboard' }" @click="ui.openDashboard()">
      <span class="ico">▦</span> Dashboard
    </button>

    <div v-for="sec in ui.grouped" :key="sec.section" class="group">
      <button class="group-head" @click="ui.toggleGroup(sec.section)">
        <span class="caret">{{ ui.collapsed[sec.section] ? '▸' : '▾' }}</span>
        {{ sectionLabel(sec.section) }}
        <span class="count">{{ sec.groups.reduce((n, g) => n + g.items.length, 0) }}</span>
      </button>
      <div v-show="!ui.collapsed[sec.section]" class="links">
        <template v-for="g in sec.groups" :key="g.label">
          <div v-if="g.label" class="subhead">{{ g.label }}</div>
          <button
            v-for="r in g.items"
            :key="r.table"
            class="nav-item"
            :class="{ active: ui.selected?.table === r.table }"
            @click="ui.openResource(r)"
          >
            {{ r.label }}
          </button>
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
  margin-top: 6px;
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
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 8px 10px 4px;
}
.caret {
  width: 10px;
}
.group-head .count {
  margin-left: auto;
  font-weight: 600;
  background: var(--surface-2);
  color: var(--primary-d);
  border-radius: 10px;
  padding: 0 7px;
}
.links {
  display: flex;
  flex-direction: column;
}
.subhead {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--secondary);
  text-transform: uppercase;
  padding: 8px 10px 2px 18px;
}
.nav-item {
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text);
  padding: 6px 12px 6px 26px;
  border-radius: 6px;
  font-size: 0.88rem;
}
.nav-item.top {
  padding-left: 12px;
  font-weight: 600;
  margin-bottom: 4px;
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
