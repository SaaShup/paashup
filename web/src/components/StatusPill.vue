<script setup lang="ts">
// A status (of a VM, a Docker container…) as a coloured pill; with a spinner while
// something is still going on. The text is always shown, so colour is never the only
// signal. The look of each status is in format.ts (`pillFor`); tones use solid, saturated
// colours (sage green / orange / red) picked from a reference palette so they stay clearly
// separated by lightness and saturation, not just hue, for colour-blind readers.
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
/* The "soft" tones (ok/info/muted: a tinted background, not a solid fill) get a thin border
 * in their own foreground colour — on the dark theme a soft tint sits close in lightness to
 * the page behind it, and without a border the chip's shape disappears into the row. */
.tone-ok {
  background: var(--ok-soft-bg);
  color: var(--ok-soft-fg);
  border: 1px solid var(--ok-soft-fg);
}
.tone-danger {
  background: var(--danger-solid-bg);
  color: #fff;
}
.tone-warn {
  background: var(--warn-solid-bg);
  color: var(--warn-solid-fg);
}
.tone-info {
  background: var(--primary-soft);
  color: var(--primary-d);
  border: 1px solid var(--primary-d);
}
.tone-muted {
  background: var(--muted-soft-bg);
  color: var(--muted-soft-fg);
  border: 1px solid var(--muted-soft-fg);
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
