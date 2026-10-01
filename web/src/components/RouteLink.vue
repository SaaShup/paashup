<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../stores/ui.js';
import { applyRoute, canGoBack, hrefFor, type Route } from '../router.js';

const props = defineProps<{ to: Route; back?: boolean }>();
const ui = useUiStore();
const href = computed(() => hrefFor(props.to));

/** Plain left click navigates in-app; modified clicks keep the browser's native behavior
 *  (new tab / window / download), which is the point of using a real link. */
function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return;
  }
  e.preventDefault();
  // a back link returns to the page the user actually came from, `to` being the fallback
  if (props.back && canGoBack()) window.history.back();
  else applyRoute(ui, props.to);
}
</script>

<template>
  <a :href="href" @click="onClick"><slot /></a>
</template>
