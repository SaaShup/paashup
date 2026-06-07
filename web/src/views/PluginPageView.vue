<script setup lang="ts">
// Hosts a plugin-contributed page (declared via the plugin's /ui/ manifest) in an
// embedded frame. The page is served by the plugin's own static assets; paas2box only
// frames it so it appears inside the app shell. A zoom control lets the user enlarge
// the embedded content (e.g. a visualization whose blocks are too small).
import { ref, computed } from 'vue';
import { useUiStore } from '../stores/ui.js';

const ui = useUiStore();
const page = computed(() => ui.pluginPage);

const ZMIN = 50;
const ZMAX = 300;
const pct = ref(150); // default larger so plugin "blocks" aren't too small
const setZoom = (p: number) => (pct.value = Math.min(ZMAX, Math.max(ZMIN, Math.round(p))));
const zoomBy = (d: number) => setZoom(pct.value + d);

// Scale the frame's content: shrink the layout box to 100/zoom% then scale it up,
// so the enlarged content fills the area and overflow scrolls.
const frameStyle = computed(() => {
  const z = pct.value / 100;
  return {
    width: `${100 / z}%`,
    height: `${100 / z}%`,
    transform: `scale(${z})`,
    transformOrigin: 'top left',
  };
});
</script>

<template>
  <div class="plugin-page" v-if="page">
    <div class="ppbar">
      <span class="pptitle">{{ page.label }}</span>
      <span class="spacer" />
      <div class="zoom">
        <button class="zbtn" :disabled="pct <= ZMIN" title="Zoom out" @click="zoomBy(-10)">−</button>
        <input
          class="zrange"
          type="range"
          :min="ZMIN"
          :max="ZMAX"
          step="10"
          :value="pct"
          @input="setZoom(($event.target as HTMLInputElement).valueAsNumber)"
        />
        <span class="zpct">{{ pct }}%</span>
        <button class="zbtn" :disabled="pct >= ZMAX" title="Zoom in" @click="zoomBy(10)">+</button>
        <button class="zbtn" title="Reset to 100%" @click="setZoom(100)">⤢</button>
      </div>
    </div>
    <div class="frame-wrap">
      <iframe :src="page.url" :title="page.label" :style="frameStyle" frameborder="0"></iframe>
    </div>
  </div>
</template>

<style scoped>
.plugin-page {
  /* fill the content area by height (the app shell forces position:relative on
     content children for the watermark layer, which would void absolute insets) */
  height: 100%;
  display: flex;
  flex-direction: column;
}
.ppbar {
  flex: 0 0 auto;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.pptitle {
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.zoom {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zbtn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  font-size: 0.95rem;
  line-height: 1;
}
.zbtn:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--secondary);
}
.zbtn:disabled {
  opacity: 0.5;
  cursor: default;
}
.zrange {
  width: 140px;
}
.zpct {
  min-width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  font-size: 0.85rem;
}
.frame-wrap {
  flex: 1;
  overflow: auto;
  position: relative;
}
.frame-wrap iframe {
  border: 0;
  display: block;
}
</style>
