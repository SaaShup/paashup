<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { api } from '../api/client.js';
import { sectionLabel, sectionRank } from '../groups.js';
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
const zoom = ref<string | null>(null); // drill-down: 'plugins' shows the per-plugin grid
const loading = ref(false);

const titleize = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const pluginOf = (endpoint: string) => endpoint.split('/').filter(Boolean)[2] ?? '';

/** run async fn over items with limited concurrency */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function loadUsage() {
  if (!ui.resources.length) return;
  loading.value = true;
  try {
    const counts = await mapLimit(ui.resources, 8, async (r) => {
      try {
        const page = await api.list(r.endpoint, { limit: 1 });
        return { section: r.section, endpoint: r.endpoint, count: page.count };
      } catch {
        return { section: r.section, endpoint: r.endpoint, count: 0 };
      }
    });
    // aggregate per section
    const by = new Map<string, SectionUsage>();
    for (const c of counts) {
      const u =
        by.get(c.section) ??
        by.set(c.section, { section: c.section, label: sectionLabel(c.section), types: 0, total: 0 }).get(c.section)!;
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
        pby.get(name) ?? pby.set(name, { name, label: titleize(name), types: 0, total: 0 }).get(name)!;
      p.types += 1;
      p.total += c.count;
    }
    pluginUsage.value = [...pby.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (zoom.value === 'plugins' && !pluginUsage.value.length) zoom.value = null;
  } finally {
    loading.value = false;
  }
}

function openSectionCard(u: SectionUsage) {
  if (u.section === 'plugins') zoom.value = 'plugins'; // zoom into per-plugin view
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
      <button v-if="zoom" class="refresh back" @click="zoom = null">← Back</button>
      <h3>{{ zoom === 'plugins' ? 'Usage by plugin' : 'Usage by section' }}</h3>
      <button class="refresh" :disabled="loading" @click="loadUsage">
        {{ loading ? 'Counting…' : '↻ Refresh' }}
      </button>
    </div>

    <!-- section overview -->
    <div v-if="!zoom" class="usage-grid">
      <button
        v-for="u in usage"
        :key="u.section"
        class="usage-card"
        :class="{ zoomable: u.section === 'plugins' }"
        :title="u.section === 'plugins' ? 'Zoom in — view usage per plugin' : 'Open this section in the menu'"
        @click="openSectionCard(u)"
      >
        <span v-if="u.section === 'plugins'" class="zoom-hint">⤢</span>
        <div class="u-total">{{ fmt(u.total) }}</div>
        <div class="u-name">{{ u.label }}</div>
        <div class="u-types">{{ u.types }} type{{ u.types === 1 ? '' : 's' }}</div>
      </button>
      <p v-if="!usage.length && !loading" class="muted">No data.</p>
    </div>

    <!-- per-plugin drill-down -->
    <div v-else class="usage-grid">
      <button
        v-for="p in pluginUsage"
        :key="p.name"
        class="usage-card"
        title="Open this plugin"
        @click="openPlugin(p.name)"
      >
        <div class="u-total">{{ fmt(p.total) }}</div>
        <div class="u-name">{{ p.label }}</div>
        <div class="u-types">{{ p.types }} type{{ p.types === 1 ? '' : 's' }}</div>
      </button>
      <p v-if="!pluginUsage.length && !loading" class="muted">No plugins loaded.</p>
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
.usage-card.zoomable {
  border-left: 4px solid var(--primary);
}
.zoom-hint {
  position: absolute;
  top: 8px;
  right: 10px;
  color: var(--primary-d);
  font-size: 0.95rem;
}
.refresh.back {
  border-color: var(--primary);
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
