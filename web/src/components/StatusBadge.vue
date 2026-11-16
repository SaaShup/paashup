<script setup lang="ts">
import { computed } from 'vue';
import { useConnectionStore } from '../stores/connection.js';

const conn = useConnectionStore();
const color = computed(
  () => ({ open: 'var(--ok)', connecting: 'var(--warn)', closed: 'var(--danger)' })[conn.status],
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
  color: inherit;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
</style>
