<script setup lang="ts">
import { ref, computed } from 'vue';
import { useUiStore } from '../stores/ui.js';
import EventLog from '../components/EventLog.vue';

const ui = useUiStore();
const resourceCount = computed(() => ui.resources.length);
const sections = computed(() => [...new Set(ui.resources.map((r) => r.section))].sort());
const logoOk = ref(true); // hide the hero if the logo file isn't present yet
const logoUrl = '/paas2box-logo.png'; // served from web/public (runtime-resolved)
</script>

<template>
  <section>
    <img
      v-show="logoOk"
      class="hero-logo"
      :src="logoUrl"
      alt="paas2box"
      @error="logoOk = false"
    />
    <div class="cards">
      <div class="card">
        <div class="num">{{ resourceCount || '…' }}</div>
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
