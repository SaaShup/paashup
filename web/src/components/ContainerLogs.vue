<script setup lang="ts">
// Container logs panel, rendered in a read-only xterm.js so ANSI colours show like in a
// terminal. Logs come from the agent through paasbox (GET …/containers/{id}/logs/),
// fetched when the panel is shown, on Refresh, or polled while "Follow" is on. The
// section can go browser-fullscreen.
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { api } from '../api/client.js';
import { execOutputText, failureText } from '../views/containerDetail.js';
import {
  hasXterm,
  openTerminal,
  safeFit,
  stripDockerFrames,
  fullscreenSupported,
  isFullscreen,
  toggleFullscreen,
} from '../xterm.js';

const props = defineProps<{
  /** paasbox proxy path, e.g. /api/plugins/docker/containers/1/logs/ (null → no container). */
  path: string | null;
  /** Docker ContainerID; null until the agent has created the container. */
  containerId: string | null;
}>();

const root = ref<HTMLElement | null>(null);
const pane = ref<HTMLElement | null>(null);
const loaded = ref(false);
const loading = ref(false);
const error = ref('');
const follow = ref(false);
const fullscreen = ref(false);
const xtermMissing = ref(false);
const POLL_MS = 3000;
let timer: ReturnType<typeof setInterval> | null = null;
let term: XTerminal | null = null;
let fit: XFitAddon | null = null;
let observer: ResizeObserver | null = null;
let last = ''; // last rendered text, to skip redundant redraws while following

function ensureTerminal() {
  if (term || !pane.value) return;
  if (!hasXterm()) {
    xtermMissing.value = true;
    return;
  }
  ({ term, fit } = openTerminal(pane.value, {
    disableStdin: true,
    convertEol: true,
    scrollback: 20000,
    cursorInactiveStyle: 'none',
    cursorStyle: 'bar',
  }));
  observer = new ResizeObserver(() => fit && safeFit(fit));
  observer.observe(pane.value);
}

function render(text: string) {
  ensureTerminal();
  if (!term) return;
  if (text === last && loaded.value) return;
  last = text;
  const t = term;
  t.reset();
  t.write(stripDockerFrames(text) || '\x1b[90m(no output)\x1b[0m', () => t.scrollToBottom());
}

async function load() {
  if (!props.path || !props.containerId || loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    const body = await api.get<unknown>(props.path);
    await nextTick();
    render(typeof body === 'string' ? body : execOutputText(body));
    loaded.value = true;
  } catch (e) {
    error.value = failureText(e);
  } finally {
    loading.value = false;
  }
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
watch(follow, (on) => {
  stopPolling();
  if (on) {
    void load();
    timer = setInterval(() => void load(), POLL_MS);
  }
});

async function onFullscreen() {
  if (!root.value) return;
  await toggleFullscreen(root.value);
}
function onFullscreenChange() {
  fullscreen.value = !!root.value && isFullscreen(root.value);
  void nextTick(() => {
    if (fit) safeFit(fit);
    term?.scrollToBottom();
  });
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  void load();
});
onUnmounted(() => {
  stopPolling();
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  observer?.disconnect();
  term?.dispose();
  term = null;
});
</script>

<template>
  <section ref="root" class="console" :class="{ fullscreen }">
    <h4>
      Logs
      <span v-if="loading" class="status">refreshing…</span>
      <span class="spacer" />
      <label class="follow">
        <input v-model="follow" type="checkbox" :disabled="!containerId" />
        Follow
      </label>
      <button class="btn btn-ghost sm" :disabled="!containerId || loading" @click="load">
        Refresh
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
    <p v-if="!containerId" class="empty">
      Not created on the host yet (no container ID) — logs are unavailable.
    </p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="xtermMissing" class="error">
      The terminal library (xterm.js) could not be loaded from the CDN.
    </p>
    <p v-else-if="!loaded" class="empty">Loading logs…</p>
    <div
      v-show="containerId && !error && !xtermMissing"
      ref="pane"
      class="pane"
      :class="{ pending: !loaded }"
      data-testid="logs"
    />
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
  margin-bottom: 14px;
}
.console.fullscreen {
  padding: 10px 14px;
  border: none;
  border-radius: 0;
  background: #2d2e2c;
}
.console.fullscreen h4,
.console.fullscreen .follow {
  color: #e2e8f0;
}
h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
}
.status {
  font-size: 0.75rem;
  font-weight: normal;
  color: var(--muted);
}
.spacer {
  flex: 1;
}
.btn.sm {
  padding: 3px 9px;
  font-size: 0.8rem;
}
.empty {
  color: var(--muted);
  margin: 4px 0 0;
}
.error {
  color: var(--danger);
  margin: 4px 0 0;
}
.follow {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  font-weight: normal;
  color: var(--muted);
  cursor: pointer;
}
.pane {
  height: 60vh;
  min-height: 240px;
  padding: 6px;
  background: #2d2e2c;
  border-radius: 6px;
  overflow: hidden;
}
.pane.pending {
  height: 0;
  min-height: 0;
  padding: 0;
}
.fullscreen .pane {
  flex: 1;
  height: auto;
}
</style>
