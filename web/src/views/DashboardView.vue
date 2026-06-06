<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { loadResources } from '../api/resources.js';
import EventLog from '../components/EventLog.vue';

const resourceCount = ref<number | null>(null);
const sections = ref<string[]>([]);

onMounted(async () => {
  try {
    const resources = await loadResources();
    resourceCount.value = resources.length;
    sections.value = [...new Set(resources.map((r) => r.section))].sort();
  } catch {
    resourceCount.value = -1;
  }
});
</script>

<template>
  <section>
    <div class="cards">
      <div class="card">
        <div class="num">{{ resourceCount === null ? '…' : resourceCount }}</div>
        <div class="lbl">API resources</div>
      </div>
      <div class="card">
        <div class="num">{{ sections.length || '…' }}</div>
        <div class="lbl">sections</div>
      </div>
    </div>
    <p class="sections">{{ sections.join(' · ') }}</p>

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
  background: #f4f4f7;
  border-radius: 10px;
  padding: 16px 22px;
  min-width: 120px;
}
.num {
  font-size: 2rem;
  font-weight: 700;
}
.lbl {
  color: #777;
  font-size: 0.85rem;
}
.sections {
  color: #666;
  font-size: 0.85rem;
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
