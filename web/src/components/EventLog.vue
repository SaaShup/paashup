<script setup lang="ts">
import { useConnectionStore } from '../stores/connection.js';

const conn = useConnectionStore();
const colors: Record<string, string> = {
  created: '#16a34a',
  updated: '#2563eb',
  deleted: '#dc2626',
};
const time = (ts: number) => new Date(ts).toLocaleTimeString();
</script>

<template>
  <div class="log">
    <p v-if="!conn.log.length" class="empty">Waiting for changes… (create/edit anything via the API)</p>
    <div v-for="(e, i) in conn.log" :key="i" class="row">
      <span class="t">{{ time(e.at) }}</span>
      <span class="ev" :style="{ color: colors[e.event] }">{{ e.event }}</span>
      <span class="ot">{{ e.object_type }}</span>
      <span class="id">#{{ e.id }}</span>
    </div>
  </div>
</template>

<style scoped>
.log {
  font-family: ui-monospace, monospace;
  font-size: 0.82rem;
  max-height: 320px;
  overflow: auto;
}
.row {
  display: flex;
  gap: 10px;
  padding: 2px 0;
}
.t {
  color: #999;
}
.ev {
  font-weight: 600;
  width: 64px;
}
.ot {
  color: #333;
}
.id {
  color: #888;
}
.empty {
  color: #888;
}
</style>
