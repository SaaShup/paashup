<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { login, loadProviders, type Provider } from '../auth/oidc.js';
import { withBase } from '../base.js';
import { theme, setTheme, THEMES } from '../theme.js';

// Public files are served under the mount base (e.g. /datacenter), like the API.
const logoSrc = withBase('/paashup-logo.svg');
const markBg = `url('${withBase('/paashup-mark.svg')}')`;

const busy = ref(false);
const providers = ref<Provider[]>([]);

onMounted(async () => {
  providers.value = (await loadProviders()).providers;
});
async function signIn(id: string) {
  busy.value = true;
  await login(id); // redirects to the chosen identity provider
}
</script>

<template>
  <div class="login">
    <div class="card">
      <img class="logo" :src="logoSrc" alt="paashup" />
      <p class="sub">Sign in with your organization account to continue.</p>
      <div class="providers">
        <button
          v-for="p in providers"
          :key="p.id"
          class="btn"
          :disabled="busy"
          @click="signIn(p.id)"
        >
          {{ busy ? 'Redirecting…' : `Sign in with ${p.label}` }}
        </button>
        <p v-if="!providers.length" class="sub">No SSO providers are configured.</p>
      </div>
    </div>
    <div class="bg" aria-hidden="true" />
    <div class="theme-switch" role="radiogroup" aria-label="Colour theme">
      <button
        v-for="t in THEMES"
        :key="t.id"
        type="button"
        class="theme-btn"
        role="radio"
        :aria-checked="theme === t.id"
        :aria-label="t.label"
        :title="t.label"
        :class="{ active: theme === t.id }"
        @click="setTheme(t.id)"
      >
        <span aria-hidden="true">{{ t.icon }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.login {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--surface);
  position: relative;
  overflow: hidden;
}
.card {
  position: relative;
  z-index: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 32px 40px 36px;
  width: 380px;
  max-width: 100%;
  text-align: center;
  box-shadow: var(--shadow-lg);
}
.logo {
  width: 190px;
  height: auto;
  margin: 0 auto 4px;
  display: block;
}
.sub {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 4px 0 24px;
}
.providers {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.btn {
  width: 100%;
  border: none;
  justify-content: center;
  background: var(--primary);
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  border-radius: 10px;
  padding: 11px 16px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.1);
}
.btn:hover {
  background: var(--primary-d);
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: var(--watermark-opacity);
  background: v-bind(markBg) center / min(560px, 55vw) no-repeat;
}
.theme-switch {
  position: absolute;
  z-index: 1;
  left: 16px;
  bottom: 16px;
  display: flex;
  gap: 8px;
}
.theme-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
}
.theme-btn:hover {
  background: var(--surface-2);
}
.theme-btn.active {
  border-color: var(--primary);
  box-shadow: var(--ring);
}
</style>
