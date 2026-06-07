<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { api } from '../api/client.js';
import { sectionLabel, sectionRank } from '../groups.js';
import EventLog from '../components/EventLog.vue';

const ui = useUiStore();
const resourceCount = computed(() => ui.resources.length);
const sections = computed(() => [...new Set(ui.resources.map((r) => r.section))].sort());
const logoOk = ref(true);
const logoUrl = '/paas2box-logo.png';

interface SectionUsage {
  section: string;
  label: string;
  types: number;
  total: number;
}
const usage = ref<SectionUsage[]>([]);
const loading = ref(false);

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
        return { section: r.section, count: page.count };
      } catch {
        return { section: r.section, count: 0 };
      }
    });
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
  } finally {
    loading.value = false;
  }
}

const grandTotal = computed(() => usage.value.reduce((n, u) => n + u.total, 0));
const fmt = (n: number) => n.toLocaleString();

onMounted(loadUsage);
</script>

<template>
  <section>
    <img v-show="logoOk" class="hero-logo" :src="logoUrl" alt="paas2box" @error="logoOk = false" />

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
      <button class="refresh" :disabled="loading" @click="loadUsage">
        {{ loading ? 'Counting…' : '↻ Refresh' }}
      </button>
    </div>
    <div class="usage-grid">
      <button
        v-for="u in usage"
        :key="u.section"
        class="usage-card"
        title="Open this section in the menu"
        @click="ui.expandedSections[u.section] = true"
      >
        <div class="u-total">{{ fmt(u.total) }}</div>
        <div class="u-name">{{ u.label }}</div>
        <div class="u-types">{{ u.types }} type{{ u.types === 1 ? '' : 's' }}</div>
      </button>
      <p v-if="!usage.length && !loading" class="muted">No data.</p>
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
.hero-logo {
  display: block;
  max-width: 260px;
  height: auto;
  margin: 0 0 22px;
}
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
