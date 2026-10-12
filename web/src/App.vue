<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { loadResources } from './api/resources.js';
import { discoverPluginMenus } from './api/pluginMenus.js';
import { useUiStore } from './stores/ui.js';
import { startRouteSync } from './router.js';
import {
  loadOidcConfig,
  handleRedirectCallback,
  ensureValidToken,
  startAutoRefresh,
  currentUsername,
  isAuthenticated,
  login,
  logout,
} from './auth/oidc.js';
import StatusBadge from './components/StatusBadge.vue';
import Sidebar from './components/Sidebar.vue';
import DashboardView from './views/DashboardView.vue';
import ResourceListView from './views/ResourceListView.vue';
import ContainerDetailView from './views/ContainerDetailView.vue';
import HostDetailView from './views/HostDetailView.vue';
import ObjectDetailView from './views/ObjectDetailView.vue';
import { DETAIL_TABLES } from './views/objectDetail.js';
import DocsView from './views/DocsView.vue';
import ApiKeysView from './views/ApiKeysView.vue';
import PluginPageView from './views/PluginPageView.vue';
import LoginView from './views/LoginView.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';

const ui = useUiStore();
const logoOk = ref(true);
const logoUrl = '/paas2box-logo.png';
const ssoEnabled = ref(false);
const loginRequired = ref(false);
const authed = ref(false);
const username = ref<string | null>(null);

// Mobile: the sidebar is an off-canvas drawer. Close it whenever the active
// view / resource / plugin page changes (i.e. after the user picks something).
const sidebarOpen = ref(false);
watch(
  () => `${ui.view}:${ui.selected?.table ?? ''}:${ui.pluginPage?.url ?? ''}`,
  () => {
    sidebarOpen.value = false;
  },
);

// Show the dedicated login page only when SSO is required and the user isn't signed in.
const showLogin = computed(() => ssoEnabled.value && loginRequired.value && !authed.value);

onMounted(async () => {
  // OIDC/SSO: finish any redirect login, then keep the token fresh, before loading data.
  const cfg = await loadOidcConfig();
  ssoEnabled.value = cfg.enabled;
  loginRequired.value = !!cfg.login_required;
  if (cfg.enabled) {
    await handleRedirectCallback();
    await ensureValidToken();
    startAutoRefresh();
    authed.value = isAuthenticated();
    username.value = currentUsername();
  }
  if (showLogin.value) return; // don't bother loading data behind a required login
  try {
    const resources = await loadResources();
    ui.setResources(resources);
    ui.setPluginMenus(await discoverPluginMenus(resources)); // plugin-contributed sidebar pages
  } catch {
    /* backend not up yet */
  }
  // URL routing
  startRouteSync(ui, watch);
});
</script>

<template>
  <ConfirmDialog />
  <LoginView v-if="showLogin" />
  <div v-else class="app">
    <header class="topbar">
      <button
        class="hamburger"
        type="button"
        aria-label="Toggle navigation"
        :aria-expanded="sidebarOpen"
        @click="sidebarOpen = !sidebarOpen"
      >
        ☰
      </button>
      <div class="brand"><span class="logo">▌</span> <span class="brand-text">paas2box</span></div>
      <input
        class="globalsearch"
        type="search"
        placeholder="Search resources…"
        v-model="ui.search"
      />
      <span class="spacer" />
      <div v-if="ssoEnabled" class="sso">
        <template v-if="username">
          <span class="who" :title="`Signed in as ${username}`">{{ username }}</span>
          <button class="sso-btn" @click="logout()">Sign out</button>
        </template>
        <button v-else class="sso-btn" @click="login()">Sign in</button>
      </div>
      <img
        v-show="logoOk"
        class="topbar-logo"
        :src="logoUrl"
        alt="paas2box"
        @error="logoOk = false"
      />
      <StatusBadge />
    </header>
    <div class="body">
      <div class="sidebar-host" :class="{ open: sidebarOpen }"><Sidebar /></div>
      <div v-if="sidebarOpen" class="scrim" @click="sidebarOpen = false" />
      <main class="content">
        <div class="page-watermark" aria-hidden="true" />
        <DashboardView v-if="ui.view === 'dashboard'" />
        <DocsView v-else-if="ui.view === 'docs'" />
        <ApiKeysView v-else-if="ui.view === 'api-keys'" />
        <PluginPageView v-else-if="ui.view === 'plugin-page'" />
        <HostDetailView
          v-else-if="ui.view === 'detail' && ui.selected?.table === 'plugin_docker_host'"
        />
        <ObjectDetailView
          v-else-if="ui.view === 'detail' && DETAIL_TABLES.has(ui.selected?.table ?? '')"
        />
        <ContainerDetailView v-else-if="ui.view === 'detail'" />
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

/* sidebar host: in-flow on desktop, an off-canvas drawer on small screens */
.sidebar-host {
  display: flex;
  flex: 0 0 auto;
  min-height: 0;
}
.sidebar-host :deep(.sidebar) {
  height: 100%;
}
.hamburger {
  display: none; /* desktop: sidebar is always visible */
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-left: -6px;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
}
.hamburger:hover {
  background: rgba(255, 255, 255, 0.18);
}
.scrim {
  display: none;
}

/* ---- tablet / mobile: sidebar becomes a toggleable drawer ---- */
@media (max-width: 900px) {
  .hamburger {
    display: inline-flex;
  }
  .sidebar-host {
    position: fixed;
    top: var(--topbar-h);
    bottom: 0;
    left: 0;
    z-index: 40;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: var(--shadow);
  }
  .sidebar-host.open {
    transform: translateX(0);
  }
  .scrim {
    display: block;
    position: fixed;
    inset: var(--topbar-h) 0 0 0;
    z-index: 30;
    background: rgba(15, 23, 42, 0.4);
  }
}
@media (max-width: 700px) {
  .topbar {
    gap: 10px;
    padding: 0 12px;
  }
  .globalsearch {
    width: auto;
    flex: 1 1 60px;
    min-width: 0;
    max-width: none;
  }
  .who {
    max-width: 84px;
  }
  .topbar-logo {
    display: none;
  }
  .content {
    padding: 16px 14px;
  }
}
@media (max-width: 460px) {
  .brand-text {
    display: none; /* keep just the ▌ glyph to save room */
  }
}
@media (prefers-reduced-motion: reduce) {
  .sidebar-host {
    transition: none;
  }
}
</style>
