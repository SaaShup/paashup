<script setup lang="ts">
import { ref } from 'vue';
import { login } from '../auth/oidc.js';

const busy = ref(false);
const logoOk = ref(true);
async function signIn() {
  busy.value = true;
  await login(); // redirects to the identity provider
}
</script>

<template>
  <div class="login">
    <div class="card">
      <img
        v-show="logoOk"
        class="logo"
        src="/paas2box-logo.png"
        alt="paas2box"
        @error="logoOk = false"
      />
      <h1><span class="bar">▌</span> paas2box</h1>
      <p class="sub">Sign in with your organization account to continue.</p>
      <button class="btn" :disabled="busy" @click="signIn">
        {{ busy ? 'Redirecting…' : 'Sign in with SSO' }}
      </button>
    </div>
    <div class="bg" aria-hidden="true" />
  </div>
</template>

<style scoped>
.login {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  position: relative;
}
.card {
  position: relative;
  z-index: 1;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 36px 40px;
  width: 360px;
  max-width: 90vw;
  text-align: center;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.08);
}
.logo {
  height: 56px;
  width: auto;
  margin-bottom: 8px;
}
h1 {
  margin: 6px 0 2px;
  font-size: 1.5rem;
  color: var(--text);
}
.bar {
  color: var(--secondary);
}
.sub {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 8px 0 22px;
}
.btn {
  width: 100%;
  border: none;
  background: var(--primary);
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  border-radius: 8px;
  padding: 11px 16px;
  cursor: pointer;
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
  opacity: 0.05;
  background: url('/paas2box-logo.png') center / min(560px, 55vw) no-repeat;
}
</style>
