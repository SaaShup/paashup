<script setup lang="ts">
import { ref } from 'vue';
import StatusBadge from './components/StatusBadge.vue';
import DashboardView from './views/DashboardView.vue';
import BrowseView from './views/BrowseView.vue';

const view = ref<'dashboard' | 'browse'>('dashboard');
</script>

<template>
  <header>
    <h1>paasbox</h1>
    <nav>
      <button :class="{ active: view === 'dashboard' }" @click="view = 'dashboard'">Dashboard</button>
      <button :class="{ active: view === 'browse' }" @click="view = 'browse'">Browse</button>
    </nav>
    <StatusBadge />
  </header>
  <main>
    <DashboardView v-if="view === 'dashboard'" />
    <BrowseView v-else />
  </main>
</template>

<style>
body {
  margin: 0;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  color: #1a1a1a;
}
header {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 24px;
  border-bottom: 1px solid #eee;
}
header h1 {
  font-size: 1.1rem;
  margin: 0;
}
nav {
  display: flex;
  gap: 6px;
  flex: 1;
}
nav button {
  border: none;
  background: none;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #555;
}
nav button.active {
  background: #eef2ff;
  color: #2563eb;
  font-weight: 600;
}
main {
  padding: 24px;
  max-width: 1100px;
}
</style>
