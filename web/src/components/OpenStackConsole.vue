<script setup lang="ts">
// VM console: embeds Nova's own noVNC console page (served by nova-novncproxy, self-contained
// including its own noVNC JS client) in an iframe. Same URL OpenStack Horizon's own "Instance
// Console" tab uses — this isn't a graphical-desktop-only view: VNC mirrors the VM's virtual
// screen (VGA framebuffer), which shows a plain text login prompt just as well on a VM with no
// GUI installed. The token in the URL is short-lived and meant for one session, so a fresh URL
// is fetched every time the panel (re)connects, never cached.
import { ref, computed, watch } from 'vue';
import { api } from '../api/client.js';
import { fullscreenSupported, isFullscreen, toggleFullscreen } from '../xterm.js';

const props = defineProps<{
  /** id of the VM (virtualization_virtual_machine), or null when none is selected. */
  vmId: number | null;
  /** Whether the panel is currently shown (drives lazy connect). */
  active: boolean;
}>();

type Status = 'idle' | 'connecting' | 'open' | 'error';

const root = ref<HTMLElement | null>(null);
const status = ref<Status>('idle');
const error = ref('');
const consoleUrl = ref('');
const fullscreen = ref(false);

const canConnect = computed(() => props.vmId != null);
const statusText = computed(() => {
  switch (status.value) {
    case 'connecting':
      return 'connecting…';
    case 'open':
      return 'connected';
    case 'error':
      return 'failed';
    default:
      return '';
  }
});

async function connect() {
  if (props.vmId == null) return;
  status.value = 'connecting';
  error.value = '';
  consoleUrl.value = '';
  try {
    const r = await api.get<{ url: string }>(`/api/plugins/openstack/servers/${props.vmId}/console/`);
    consoleUrl.value = r.url;
    status.value = 'open';
  } catch (e) {
    const d = (e as { detail?: { detail?: unknown } }).detail;
    error.value = typeof d?.detail === 'string' ? d.detail : String(e);
    status.value = 'error';
  }
}

async function onFullscreen() {
  if (!root.value) return;
  await toggleFullscreen(root.value);
}
function onFullscreenChange() {
  fullscreen.value = !!root.value && isFullscreen(root.value);
}

watch(
  () => props.active,
  (on) => {
    if (on && status.value === 'idle') void connect();
  },
  { immediate: true },
);

document.addEventListener('fullscreenchange', onFullscreenChange);
</script>

<template>
  <section ref="root" class="console" :class="{ fullscreen }">
    <h4>
      Recovery
      <span v-if="statusText" class="status" :class="status">{{ statusText }}</span>
      <span class="spacer" />
      <button class="btn btn-ghost sm" :disabled="!canConnect || status === 'connecting'" @click="connect">
        {{ status === 'open' ? 'Restart' : 'Reconnect' }}
      </button>
      <button
        v-if="fullscreenSupported()"
        class="btn btn-ghost sm"
        :title="fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'"
        @click="onFullscreen"
      >
        {{ fullscreen ? '⤡ Exit' : '⤢' }}
      </button>
    </h4>
    <p class="muted hint">This is the VM's own screen — log in with its OS credentials.</p>
    <p v-if="status === 'error'" class="error">{{ error }}</p>
    <iframe
      v-if="consoleUrl"
      class="pane"
      :src="consoleUrl"
      title="VM console"
      allow="fullscreen"
    />
    <div v-else class="pane placeholder" />
  </section>
</template>

<style scoped>
.console {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
/* browser fullscreen: the section is the fullscreen element */
.console.fullscreen {
  padding: 10px 14px;
  border: none;
  border-radius: 0;
  background: var(--terminal-bg);
}
.console.fullscreen h4,
.console.fullscreen .hint {
  color: var(--terminal-fg);
}
h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
}
.status {
  font-size: 0.75rem;
  font-weight: normal;
  color: var(--muted);
}
.status.open {
  color: var(--ok);
}
.status.error {
  color: var(--danger);
}
.spacer {
  flex: 1;
}
.btn.sm {
  padding: 3px 9px;
  font-size: 0.8rem;
}
.hint {
  margin: 0 0 10px;
  font-size: 0.82rem;
}
.error {
  color: var(--danger);
  margin: 0 0 10px;
}
.pane {
  height: 60vh;
  min-height: 240px;
  width: 100%;
  border: 0;
  border-radius: 6px;
  background: #000;
}
.placeholder {
  background: var(--terminal-bg);
}
.fullscreen .pane {
  flex: 1;
  height: auto;
}
</style>
