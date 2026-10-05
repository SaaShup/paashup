<script setup lang="ts">
// Interactive container terminal (xterm.js) over paasbox's WebSocket relay
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { withCredential } from '../websocket/socket.js';
import { BASE } from '../base.js';
import {
  hasXterm,
  openTerminal,
  safeFit,
  fullscreenSupported,
  isFullscreen,
  toggleFullscreen,
} from '../xterm.js';

const props = defineProps<{
  /** paasbox WebSocket path, e.g. /api/plugins/docker/containers/1/ws/ (null → no container). */
  wsPath: string | null;
  /** Docker ContainerID; null until the agent has created the container. */
  containerId: string | null;
  /** Whether the panel is currently shown (drives lazy connect + refit). */
  active: boolean;
}>();

const MSG = {
  stdin: 0,
  stdout: 1,
  stderr: 2,
  resize: 50,
  resume: 100,
  pause: 101,
  end: 102,
  stopped: 200,
  shutdown: 201,
  error: 202,
} as const;

type Status = 'idle' | 'connecting' | 'open' | 'closed';

const root = ref<HTMLElement | null>(null);
const pane = ref<HTMLElement | null>(null);
const shell = ref('sh');
const status = ref<Status>('idle');
const notice = ref(''); // why the session ended, shown under the pane
const fullscreen = ref(false);
const xtermMissing = ref(false);

let term: XTerminal | null = null;
let fit: XFitAddon | null = null;
let ws: WebSocket | null = null;
let ready = false; // the agent sent `resume`: input may flow
let readyTimer: ReturnType<typeof setTimeout> | null = null;
const queued: Uint8Array[] = []; // input typed before `resume`
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let observer: ResizeObserver | null = null;

const canConnect = computed(() => !!props.wsPath && !!props.containerId && hasXterm());
const statusText = computed(() => {
  switch (status.value) {
    case 'connecting':
      return 'connecting…';
    case 'open':
      return 'connected';
    case 'closed':
      return 'disconnected';
    default:
      return '';
  }
});

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const u = new URL(`${proto}://${location.host}${BASE}${props.wsPath}`);
  u.searchParams.set('tty', 'true');
  u.searchParams.set('command', shell.value.trim() || 'sh');
  return withCredential(u.toString());
}

function send(code: number, payload: Uint8Array = new Uint8Array()) {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = code;
  frame.set(payload, 1);
  if (ws?.readyState === WebSocket.OPEN && ready) ws.send(frame);
  else if (ws && ws.readyState <= WebSocket.OPEN) queued.push(frame);
}

function sendResize() {
  if (!term) return;
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint16(0, term.rows, true);
  new DataView(b.buffer).setUint16(2, term.cols, true);
  send(MSG.resize, b);
}

function markReady() {
  if (ready) return;
  ready = true;
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = null;
  for (const f of queued) ws?.send(f);
  queued.length = 0;
  sendResize();
}

function onMessage(ev: MessageEvent<ArrayBuffer>) {
  const m = new Uint8Array(ev.data);
  if (!m.length || !term) return;
  switch (m[0]) {
    case MSG.stdout:
    case MSG.stderr:
      term.write(m.subarray(1));
      break;
    case MSG.resume:
      markReady();
      break;
    case MSG.pause:
      ready = false;
      break;
    case MSG.stopped:
      notice.value = `Process exited with code ${m[1] ?? 0}.`;
      ws?.close();
      break;
    case MSG.shutdown:
      notice.value = 'The agent closed the session.';
      ws?.close();
      break;
    case MSG.error:
      term.write(`\r\n\x1b[31m${decoder.decode(m.subarray(1))}\x1b[0m\r\n`);
      break;
    default:
      break;
  }
}

function ensureTerminal() {
  if (term || !pane.value) return;
  if (!hasXterm()) {
    xtermMissing.value = true;
    return;
  }
  ({ term, fit } = openTerminal(pane.value, { cursorBlink: true, scrollback: 5000 }));
  term.onData((d) => send(MSG.stdin, encoder.encode(d)));
  term.onResize(() => sendResize());
  observer = new ResizeObserver(() => fit && safeFit(fit));
  observer.observe(pane.value);
}

function disconnect() {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = null;
  ready = false;
  queued.length = 0;
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState <= WebSocket.OPEN) ws.close();
    ws = null;
  }
}

function connect() {
  if (!props.wsPath || !props.containerId) return;
  ensureTerminal();
  if (!term) return;
  disconnect();
  notice.value = '';
  status.value = 'connecting';
  term.reset();
  const sock = new WebSocket(wsUrl());
  sock.binaryType = 'arraybuffer';
  ws = sock;
  sock.onopen = () => {
    status.value = 'open';
    // the agent announces readiness with `resume`; don't hold input forever if it doesn't
    readyTimer = setTimeout(markReady, 1500);
    term?.focus();
  };
  sock.onmessage = onMessage;
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    status.value = 'closed';
    ready = false;
    ws = null;
    // application codes (4000+) carry a human-readable reason from paasbox
    if (!notice.value) {
      notice.value =
        ev.reason ||
        (ev.code >= 4000 ? 'Session refused.' : ev.wasClean ? 'Session closed.' : 'Connection lost.');
    }
    term?.write(`\r\n\x1b[90m[${notice.value}]\x1b[0m\r\n`);
  };
  sock.onerror = () => {
    /* the close event follows with the details */
  };
}

async function onFullscreen() {
  if (!root.value) return;
  await toggleFullscreen(root.value);
}
function onFullscreenChange() {
  fullscreen.value = !!root.value && isFullscreen(root.value);
  void nextTick(() => fit && safeFit(fit));
}

watch(
  () => props.active,
  async (on) => {
    if (!on) return;
    await nextTick();
    if (status.value === 'idle') connect();
    else if (fit) safeFit(fit);
  },
  { immediate: true },
);

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange));
onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  disconnect();
  observer?.disconnect();
  term?.dispose();
  term = null;
});
</script>

<template>
  <section ref="root" class="console" :class="{ fullscreen }">
    <h4>
      Terminal
      <span v-if="statusText" class="status" :class="status">{{ statusText }}</span>
      <span class="spacer" />
      <label class="shell">
        <span>Shell</span>
        <input
          v-model="shell"
          type="text"
          class="shell-input"
          spellcheck="false"
          :disabled="status === 'connecting'"
          @keydown.enter="connect"
        />
      </label>
      <button
        class="btn btn-ghost sm"
        :disabled="!canConnect || status === 'connecting'"
        @click="connect"
      >
        {{ status === 'open' ? 'Restart' : status === 'closed' ? 'Reconnect' : 'Connect' }}
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
      Not created on the host yet (no container ID) — the terminal is unavailable.
    </p>
    <p v-else-if="xtermMissing" class="error">
      The terminal library (xterm.js) could not be loaded from the CDN.
    </p>
    <div v-show="containerId && !xtermMissing" ref="pane" class="pane" data-testid="terminal" />
    <p v-if="notice && status === 'closed'" class="notice">{{ notice }}</p>
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
/* browser fullscreen: the section is the fullscreen element */
.console.fullscreen {
  padding: 10px 14px;
  border: none;
  border-radius: 0;
  background: #2d2e2c;
}
.console.fullscreen h4,
.console.fullscreen .shell,
.console.fullscreen .notice {
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
.status.open {
  color: var(--ok);
}
.status.closed {
  color: var(--danger);
}
.spacer {
  flex: 1;
}
.shell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: normal;
  color: var(--muted);
}
.shell-input {
  width: 6em;
  padding: 3px 7px;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
}
.btn.sm {
  padding: 3px 9px;
  font-size: 0.8rem;
}
.empty,
.notice {
  color: var(--muted);
  margin: 4px 0 0;
}
.error {
  color: var(--danger);
  margin: 4px 0 0;
}
.pane {
  height: 60vh;
  min-height: 240px;
  padding: 6px;
  background: #2d2e2c;
  border-radius: 6px;
  overflow: hidden;
}
.fullscreen .pane {
  flex: 1;
  height: auto;
}
</style>
