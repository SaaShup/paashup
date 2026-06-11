<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { loadResources } from './api/resources.js';
import { discoverPluginMenus } from './api/pluginMenus.js';
import { useUiStore } from './stores/ui.js';
import {
  loadOidcConfig,
  handleRedirectCallback,
  ensureValidToken,
  startAutoRefresh,
  currentUsername,
  login,
  logout,
} from './auth/oidc.js';
import StatusBadge from './components/StatusBadge.vue';
import Sidebar from './components/Sidebar.vue';
import DashboardView from './views/DashboardView.vue';
import ResourceListView from './views/ResourceListView.vue';
import DocsView from './views/DocsView.vue';
import PluginPageView from './views/PluginPageView.vue';

const ui = useUiStore();
const logoOk = ref(true);
const logoUrl = '/paas2box-logo.png';
const ssoEnabled = ref(false);
const username = ref<string | null>(null);

onMounted(async () => {
  // OIDC/SSO: finish any redirect login, then keep the token fresh, before loading data.
  const cfg = await loadOidcConfig();
  ssoEnabled.value = cfg.enabled;
  if (cfg.enabled) {
    await handleRedirectCallback();
    await ensureValidToken();
    startAutoRefresh();
    username.value = currentUsername();
  }
  try {
    const resources = await loadResources();
    ui.setResources(resources);
    ui.setPluginMenus(await discoverPluginMenus(resources)); // plugin-contributed sidebar pages
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
      <div v-if="ssoEnabled" class="sso">
        <template v-if="username">
          <span class="who" :title="`Signed in as ${username}`">{{ username }}</span>
          <button class="sso-btn" @click="logout()">Sign out</button>
        </template>
        <button v-else class="sso-btn" @click="login()">Sign in</button>
      </div>
      <img v-show="logoOk" class="topbar-logo" :src="logoUrl" alt="paas2box" @error="logoOk = false" />
      <StatusBadge />
    </header>
    <div class="body">
      <Sidebar />
      <main class="content">
        <div class="page-watermark" aria-hidden="true" />
        <DashboardView v-if="ui.view === 'dashboard'" />
        <DocsView v-else-if="ui.view === 'docs'" />
        <PluginPageView v-else-if="ui.view === 'plugin-page'" />
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
.sso {
  display: flex;
  align-items: center;
  gap: 8px;
}
.who {
  color: #fff;
  font-size: 0.85rem;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sso-btn {
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 0.82rem;
  cursor: pointer;
}
.sso-btn:hover {
  background: rgba(255, 255, 255, 0.24);
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
