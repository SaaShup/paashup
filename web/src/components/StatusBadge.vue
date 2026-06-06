<script setup lang="ts">
import { computed } from 'vue';
import { useConnectionStore } from '../stores/connection.js';

const conn = useConnectionStore();
const color = computed(
  () => ({ open: '#16a34a', connecting: '#d97706', closed: '#dc2626' })[conn.status],
);
</script>

<template>
  <span class="badge">
    <span class="dot" :style="{ background: color }" />
    live: {{ conn.status }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: #444;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
</style>
