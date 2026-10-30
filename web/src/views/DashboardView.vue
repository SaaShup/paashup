<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUiStore } from '../stores/ui.js';
import type { Route } from '../router.js';
import RouteLink from '../components/RouteLink.vue';
import ServiceLinks from '../components/ServiceLinks.vue';

const ui = useUiStore();
const loading = ref(false);

// Known, meaningful resource types — each card links straight to its list.
const RESOURCE_CARDS: { table: string; label: string }[] = [
  { table: 'plugin_docker_host', label: 'Docker hosts' },
  { table: 'plugin_docker_container', label: 'Docker containers' },
  { table: 'virtualization_virtual_machine', label: 'VMs' },
  { table: 'dcim_region', label: 'Regions' },
  { table: 'extras_journalentry', label: 'Logs' },
];

interface ResourceCard {
  table: string;
  label: string;
  count: number;
  route: Route;
}

const cards = computed<ResourceCard[]>(() =>
  RESOURCE_CARDS.filter((c) => ui.resources.some((r) => r.table === c.table)).map((c) => ({
    ...c,
    count: ui.counts[c.table] ?? 0,
    route: { view: 'list', table: c.table },
  })),
);

const fmt = (n: number) => n.toLocaleString();

async function loadCounts() {
  if (!ui.resources.length) return;
  loading.value = true;
  try {
    // Counts live in the UI store (shared with the sidebar item badges + cached), but
    // only ask for the few tables this page actually shows — the dashboard used to pass
    // the whole resource catalog (every table in the schema, dozens of requests) even
    // though it only ever displayed 5 counts, which is what made it slow. No manual
    // refresh either: a page reload is fast enough, so there's nothing to re-trigger.
    const wanted = ui.resources.filter((r) => RESOURCE_CARDS.some((c) => c.table === r.table));
    await ui.loadCounts(wanted);
  } finally {
    loading.value = false;
  }
}

// Load as soon as the resource catalog is available (App fetches it async), and on
// every revisit to the dashboard — so the counters always appear by default.
watch(
  () => ui.resources.length,
  (n) => {
    if (n && !loading.value) loadCounts();
  },
  { immediate: true },
);
</script>

<template>
  <section>
    <h3>Resources</h3>

    <div class="usage-grid">
      <RouteLink v-for="c in cards" :key="c.table" :to="c.route" class="usage-card">
        <div class="u-total">{{ loading ? '…' : fmt(c.count) }}</div>
        <div class="u-name">{{ c.label }}</div>
      </RouteLink>
      <p v-if="!cards.length && !loading" class="muted">No data.</p>
    </div>

    <ServiceLinks />
  </section>
</template>

<style scoped>
.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin: 12px 0 8px;
}
.usage-card {
  display: block;
  text-align: left;
  text-decoration: none;
  color: inherit;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}
.usage-card:hover {
  border-color: #d1d5db;
  box-shadow: var(--shadow-lg);
  transform: translateY(-1px);
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
</style>
