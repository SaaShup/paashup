<script setup lang="ts">
// A status (of a VM, a Docker container…) as a coloured pill; with a spinner while
// something is still going on. The text is always shown, so the colour is never the only
// signal. The look of each status is in format.ts (`pillFor`).
import type { StatusTone } from '../format.js';

defineProps<{ label: string; tone: StatusTone; busy?: boolean }>();
</script>

<template>
  <span class="pill" :class="`tone-${tone}`" :title="busy ? `${label} — in progress` : label">
    <span v-if="busy" class="spin" aria-hidden="true" />
    {{ label }}
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
}
.tone-ok {
  background: #dcfce7;
  color: #166534;
}
.tone-danger {
  background: #fee2e2;
  color: #991b1b;
}
.tone-warn {
  background: #fef3c7;
  color: #92400e;
}
.tone-info {
  background: var(--primary-soft);
  color: var(--primary-d);
}
.tone-muted {
  background: #f1f5f9;
  color: #475569;
}
.spin {
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
/* no motion asked for: a still dot says the same thing */
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
    background: currentColor;
  }
}
</style>
