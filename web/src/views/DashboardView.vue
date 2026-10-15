<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { isHiddenResource, sectionLabel, sectionRank } from '../groups.js';
import EventLog from '../components/EventLog.vue';

const ui = useUiStore();
const resourceCount = computed(() => ui.resources.length);
const sections = computed(() => [...new Set(ui.resources.map((r) => r.section))].sort());
interface SectionUsage {
  section: string;
  label: string;
  types: number;
  total: number;
}
interface PluginUsage {
  name: string;
  label: string;
  types: number;
  total: number;
}
const usage = ref<SectionUsage[]>([]);
const pluginUsage = ref<PluginUsage[]>([]);
const pluginsOpen = ref(false); // inline sub-tree under the Plugins card
const loading = ref(false);

const titleize = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const pluginOf = (endpoint: string) => endpoint.split('/').filter(Boolean)[2] ?? '';

async function loadUsage(force = false) {
  if (!ui.resources.length) return;
  loading.value = true;
  try {
    // Counts live in the UI store (shared with the sidebar item badges + cached).
    await ui.loadCounts(ui.resources, force);
    const counts = ui.resources
      .filter((r) => !isHiddenResource(r))
      .map((r) => ({
        section: r.section,
        endpoint: r.endpoint,
        count: ui.counts[r.table] ?? 0,
      }));
    // aggregate per section
    const by = new Map<string, SectionUsage>();
    for (const c of counts) {
      const u =
        by.get(c.section) ??
        by
          .set(c.section, {
            section: c.section,
            label: sectionLabel(c.section),
            types: 0,
            total: 0,
          })
          .get(c.section)!;
      u.types += 1;
      u.total += c.count;
    }
    usage.value = [...by.values()].sort(
      (a, b) => sectionRank(a.section) - sectionRank(b.section) || a.label.localeCompare(b.label),
    );
    // aggregate per plugin (for the drill-down)
    const pby = new Map<string, PluginUsage>();
    for (const c of counts) {
      if (c.section !== 'plugins') continue;
      const name = pluginOf(c.endpoint);
      const p =
        pby.get(name) ??
        pby.set(name, { name, label: titleize(name), types: 0, total: 0 }).get(name)!;
      p.types += 1;
      p.total += c.count;
    }
    pluginUsage.value = [...pby.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (!pluginUsage.value.length) pluginsOpen.value = false;
  } finally {
    loading.value = false;
  }
}

function onCard(u: SectionUsage) {
  if (u.section === 'plugins')
    pluginsOpen.value = !pluginsOpen.value; // expand inline sub-tree
  else ui.expandedSections[u.section] = true; // expand that section in the menu
}

function openPlugin(name: string) {
  const r = ui.resources.find((x) => x.section === 'plugins' && pluginOf(x.endpoint) === name);
  if (r) ui.openResource(r); // jump into the plugin's first resource
}

const grandTotal = computed(() => usage.value.reduce((n, u) => n + u.total, 0));
const fmt = (n: number) => n.toLocaleString();

// Load as soon as the resource catalog is available (App fetches it async), and on
// every revisit to the dashboard — so the counters always appear by default.
watch(
  () => ui.resources.length,
  (n) => {
    if (n && !usage.value.length && !loading.value) loadUsage();
  },
  { immediate: true },
);
</script>

<template>
  <section>
    <div class="cards">
      <div class="card">
        <div class="num">{{ resourceCount || '…' }}</div>
        <div class="lbl">API resources</div>
      </div>
      <div class="card">
        <div class="num">{{ sections.length || '…' }}</div>
        <div class="lbl">sections</div>
      </div>
      <div class="card">
        <div class="num">{{ loading ? '…' : fmt(grandTotal) }}</div>
        <div class="lbl">total records</div>
      </div>
    </div>

    <div class="usage-head">
      <h3>Usage by section</h3>
      <button class="refresh" :disabled="loading" @click="loadUsage(true)">
        {{ loading ? 'Counting…' : '↻ Refresh' }}
      </button>
    </div>

    <div class="usage-grid">
      <button
        v-for="u in usage"
        :key="u.section"
        class="usage-card"
        :class="{
          expandable: u.section === 'plugins',
          open: u.section === 'plugins' && pluginsOpen,
        }"
        :title="
          u.section === 'plugins' ? 'Expand — usage per plugin' : 'Open this section in the menu'
        "
        @click="onCard(u)"
      >
        <span v-if="u.section === 'plugins'" class="caret">{{ pluginsOpen ? '▾' : '▸' }}</span>
        <div class="u-total">{{ fmt(u.total) }}</div>
        <div class="u-name">{{ u.label }}</div>
        <div class="u-types">{{ u.types }} type{{ u.types === 1 ? '' : 's' }}</div>
      </button>
      <p v-if="!usage.length && !loading" class="muted">No data.</p>
    </div>

    <!-- inline sub-tree under the Plugins card (like a menu) -->
    <div v-if="pluginsOpen && pluginUsage.length" class="subtree">
      <div class="subtree-title">Plugins</div>
      <button
        v-for="p in pluginUsage"
        :key="p.name"
        class="subtree-item"
        title="Open this plugin"
        @click="openPlugin(p.name)"
      >
        <span class="tw-name">{{ p.label }}</span>
        <span class="tw-types">{{ p.types }} type{{ p.types === 1 ? '' : 's' }}</span>
        <span class="tw-total">{{ fmt(p.total) }}</span>
      </button>
    </div>

    <h3>Live activity</h3>
    <p class="hint">
      Updates stream over the WebSocket change-feed. Try
      <code>curl -X POST localhost:8000/api/dcim/manufacturers/ -d '{"name":"X","slug":"x"}'</code>.
    </p>
    <EventLog />
  </section>
</template>

<style scoped>
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 22px;
  min-width: 120px;
}
.num {
  font-size: 2rem;
  font-weight: 700;
  color: var(--primary-d);
}
.lbl {
  color: var(--muted);
  font-size: 0.85rem;
}
.usage-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 26px;
}
.usage-head h3 {
  margin: 0;
}
.refresh {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 0.82rem;
}
.refresh:hover {
  background: var(--surface);
}
.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin: 12px 0 8px;
}
.usage-card {
  position: relative;
  text-align: left;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.12s;
}
.usage-card:hover {
  border-color: var(--primary);
}
.usage-card.expandable {
  border-left: 4px solid var(--primary);
}
.usage-card.open {
  background: var(--surface);
}
.caret {
  position: absolute;
  top: 8px;
  right: 10px;
  color: var(--primary-d);
  font-size: 0.8rem;
}
/* inline sub-tree (menu) under the Plugins card */
.subtree {
  margin: 4px 0 8px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: 10px;
  background: var(--surface);
  padding: 6px;
  max-width: 520px;
}
.subtree-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 6px 10px 4px;
}
.subtree-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px 10px 8px 22px;
  border-radius: 6px;
  position: relative;
}
.subtree-item::before {
  content: '';
  position: absolute;
  left: 10px;
  top: 0;
  bottom: 50%;
  border-left: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  width: 6px;
}
.subtree-item:hover {
  background: var(--surface-2);
}
.tw-name {
  font-weight: 600;
  font-size: 0.9rem;
}
.tw-types {
  color: var(--muted);
  font-size: 0.78rem;
}
.tw-total {
  margin-left: auto;
  font-weight: 700;
  color: var(--primary-d);
}
.u-total {
  font-size: 1.7rem;
  font-weight: 700;
  color: var(--primary-d);
}
.u-name {
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
}
.u-types {
  color: var(--muted);
  font-size: 0.78rem;
}
.hint {
  color: #666;
  font-size: 0.85rem;
}
code {
  background: #f0f0f3;
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
