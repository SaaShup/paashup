<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { loadResources } from './api/resources.js';
import { useUiStore } from './stores/ui.js';
import StatusBadge from './components/StatusBadge.vue';
import Sidebar from './components/Sidebar.vue';
import DashboardView from './views/DashboardView.vue';
import ResourceListView from './views/ResourceListView.vue';
import DocsView from './views/DocsView.vue';

const ui = useUiStore();
const logoOk = ref(true);
const logoUrl = '/paas2box-logo.png';

onMounted(async () => {
  try {
    ui.setResources(await loadResources());
  } catch {
    /* backend not up yet */
  }
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand"><span class="logo">▌</span> paas2box</div>
      <input class="globalsearch" type="search" placeholder="Search resources…" v-model="ui.search" />
      <span class="spacer" />
      <img v-show="logoOk" class="topbar-logo" :src="logoUrl" alt="paas2box" @error="logoOk = false" />
      <StatusBadge />
    </header>
    <div class="body">
      <Sidebar />
      <main class="content">
        <div class="page-watermark" aria-hidden="true" />
        <DashboardView v-if="ui.view === 'dashboard'" />
        <DocsView v-else-if="ui.view === 'docs'" />
        <ResourceListView v-else />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.topbar {
  height: var(--topbar-h);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 18px;
  background: var(--primary);
  color: #fff;
}
.brand {
  font-weight: 700;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  gap: 6px;
}
.logo {
  color: var(--secondary);
}
.globalsearch {
  width: 320px;
  max-width: 40vw;
  border: none;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.globalsearch::placeholder {
  color: rgba(255, 255, 255, 0.8);
}
.globalsearch:focus {
  background: rgba(255, 255, 255, 0.28);
  box-shadow: none;
}
.spacer {
  flex: 1;
}
.topbar-logo {
  height: 40px;
  width: auto;
  background: #fff;
  border-radius: 6px;
  padding: 3px 6px;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.content {
  flex: 1;
  overflow: auto;
  padding: 22px 28px;
  background: var(--bg);
  position: relative;
}
/* faint logo watermark behind every page — never intercepts clicks, never hides content */
.page-watermark {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.04;
  background-image: url('/paas2box-logo.png');
  background-repeat: no-repeat;
  background-position: center;
  background-attachment: fixed;
  background-size: min(560px, 55vw);
}
/* keep real page content above the watermark */
.content > :not(.page-watermark) {
  position: relative;
  z-index: 1;
}
</style>
