// ContainerTerminal.vue: an interactive shell over paashup's WebSocket relay, speaking
// the docker-exec-websocket-server frame protocol (first byte = message code). `WebSocket`
// and the xterm.js globals are faked so the test drives the frame exchange directly,
// without a real network or a real terminal renderer.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ContainerTerminal from '../src/components/ContainerTerminal.vue';

const base = vi.hoisted(() => ({ value: '' }));
vi.mock('../src/base.js', () => ({
  get BASE() {
    return base.value;
  },
}));

const MSG = {
  stdin: 0,
  stdout: 1,
  stderr: 2,
  resize: 50,
  resume: 100,
  pause: 101,
  stopped: 200,
  shutdown: 201,
  error: 202,
} as const;

// ---- fake xterm.js ----------------------------------------------------------------------
class FakeTerm {
  written: Uint8Array[] = [];
  disposed = false;
  focused = false;
  cols = 80;
  rows = 24;
  private dataHandler: ((d: string) => void) | null = null;
  loadAddon(_addon: unknown) {}
  open() {}
  write(data: Uint8Array) {
    this.written.push(data);
  }
  reset() {
    this.written = [];
  }
  focus() {
    this.focused = true;
  }
  onData(cb: (d: string) => void) {
    this.dataHandler = cb;
    return { dispose() {} };
  }
  onResize() {
    return { dispose() {} };
  }
  dispose() {
    this.disposed = true;
  }
  /** Test helper: simulate the user typing at the prompt. */
  type(s: string) {
    this.dataHandler?.(s);
  }
  writtenText(): string {
    const dec = new TextDecoder();
    return this.written.map((u) => dec.decode(u)).join('');
  }
}
class FakeFit {
  fit() {}
}
let lastTerm: FakeTerm | null = null;
/** Records each constructed instance; called from the fake's constructor, not aliased. */
const captureTerm = (t: FakeTerm) => (lastTerm = t);
function installFakeXterm() {
  class FakeTerminal extends FakeTerm {
    constructor(..._args: unknown[]) {
      super();
      captureTerm(this);
    }
  }
  (globalThis as Record<string, unknown>).Terminal = FakeTerminal;
  (globalThis as Record<string, unknown>).FitAddon = { FitAddon: FakeFit };
}
function uninstallFakeXterm() {
  delete (globalThis as Record<string, unknown>).Terminal;
  delete (globalThis as Record<string, unknown>).FitAddon;
}
class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

// ---- fake WebSocket -----------------------------------------------------------------
// Deterministic stand-in: `open()` and server frames/close are driven explicitly by the
// test rather than a real socket, but readyState/onopen/onmessage/onclose behave like
// the real thing closely enough for the component's logic.
class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: Uint8Array) {
    if (this.readyState !== FakeSocket.OPEN) throw new Error('socket not open');
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '', wasClean: true });
  }
  // ---- test helpers ----
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  serverFrame(code: number, payload: Uint8Array | string = new Uint8Array()) {
    const p = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    const frame = new Uint8Array(1 + p.length);
    frame[0] = code;
    frame.set(p, 1);
    this.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });
  }
  serverClose(code: number, reason: string, wasClean = true) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean });
  }
  lastSentCode(): number | undefined {
    return this.sent.at(-1)?.[0];
  }
  lastSentPayload(): string {
    const f = this.sent.at(-1);
    return f ? new TextDecoder().decode(f.subarray(1)) : '';
  }
}

const props = (over: Partial<{ wsPath: string | null; containerId: string | null; active: boolean }> = {}) => ({
  wsPath: '/api/plugins/docker/containers/1/ws/',
  containerId: 'cid-1',
  active: true,
  ...over,
});

describe('ContainerTerminal', () => {
  beforeEach(() => {
    installFakeXterm();
    lastTerm = null;
    FakeSocket.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    uninstallFakeXterm();
    vi.unstubAllGlobals();
  });

  it('does not connect when there is no ContainerID, and shows the "unavailable" message', async () => {
    const w = mount(ContainerTerminal, { props: props({ containerId: null }) });
    await flushPromises();
    expect(w.text()).toContain('the terminal is unavailable');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('does not connect until the panel becomes active', async () => {
    const w = mount(ContainerTerminal, { props: props({ active: false }) });
    await flushPromises();
    expect(FakeSocket.instances).toHaveLength(0);
    await w.setProps({ active: true });
    await flushPromises();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('connects to the ws path with tty=true and the default "sh" shell', async () => {
    mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    const url = new URL(sock.url);
    expect(url.pathname).toBe('/api/plugins/docker/containers/1/ws/');
    expect(url.searchParams.get('tty')).toBe('true');
    expect(url.searchParams.get('command')).toBe('sh');
    expect(sock.binaryType).toBe('arraybuffer');
  });

  it.each([
    ['', '/api/plugins/docker/containers/1/ws/'],
    ['/datacenter', '/datacenter/api/plugins/docker/containers/1/ws/'],
  ])('prefixes the ws URL with the mount base %j', async (prefix, expected) => {
    base.value = prefix;
    try {
      mount(ContainerTerminal, { props: props() });
      await flushPromises();
      expect(new URL(FakeSocket.instances[0]!.url).pathname).toBe(expected);
    } finally {
      base.value = '';
    }
  });

  it('shows connecting → connected status text as the socket opens', async () => {
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    expect(w.text()).toContain('connecting');
    FakeSocket.instances[0]!.open();
    await flushPromises();
    expect(w.text()).toContain('connected');
  });

  it('sends a resize frame and flushes queued keystrokes once the agent signals resume', async () => {
    mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    await flushPromises();

    // typed before `resume`: queued, not sent yet
    lastTerm!.type('a');
    expect(sock.sent).toHaveLength(0);

    sock.serverFrame(MSG.resume);
    await flushPromises();

    // resize sent using the (fake) terminal's rows/cols
    const resizeFrame = sock.sent.find((f) => f[0] === MSG.resize)!;
    expect(resizeFrame).toBeDefined();
    const dv = new DataView(resizeFrame.buffer, resizeFrame.byteOffset + 1);
    expect(dv.getUint16(0, true)).toBe(lastTerm!.rows);
    expect(dv.getUint16(2, true)).toBe(lastTerm!.cols);

    // the queued keystroke was flushed
    expect(sock.sent.some((f) => f[0] === MSG.stdin)).toBe(true);
  });

  it('sends further keystrokes immediately once ready, as stdin frames', async () => {
    mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.serverFrame(MSG.resume);
    await flushPromises();
    sock.sent = []; // drop the resize/queue-flush frames from setup

    lastTerm!.type('ls\r');
    expect(sock.lastSentCode()).toBe(MSG.stdin);
    expect(sock.lastSentPayload()).toBe('ls\r');
  });

  it('writes stdout/stderr frames to the terminal', async () => {
    mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.serverFrame(MSG.stdout, 'hello ');
    sock.serverFrame(MSG.stderr, 'oops');
    await flushPromises();
    expect(lastTerm!.writtenText()).toBe('hello oops');
  });

  it('a `pause` frame stops sending until the next `resume`', async () => {
    mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.serverFrame(MSG.resume);
    await flushPromises();
    sock.serverFrame(MSG.pause);
    sock.sent = [];

    lastTerm!.type('x');
    expect(sock.sent).toHaveLength(0); // queued again while paused

    sock.serverFrame(MSG.resume);
    await flushPromises();
    expect(sock.sent.some((f) => f[0] === MSG.stdin)).toBe(true); // flushed
  });

  it('`stopped` shows the exit code and closes the socket', async () => {
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.serverFrame(MSG.stopped, Uint8Array.of(7));
    await flushPromises();
    sock.serverClose(1000, '', true);
    await flushPromises();
    expect(w.text()).toContain('exited with code 7');
  });

  it('`shutdown` reports the agent closed the session', async () => {
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    sock.serverFrame(MSG.shutdown);
    sock.serverClose(1000, '', true);
    await flushPromises();
    expect(w.text()).toContain('agent closed the session');
  });

  it('a paashup application close code (4000+) shows the relayed reason', async () => {
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.serverClose(4004, 'Container not created on its host yet', false);
    await flushPromises();
    expect(w.text()).toContain('disconnected');
    expect(w.text()).toContain('Container not created on its host yet');
  });

  it('Restart/Reconnect relabels with status and reconnects on click', async () => {
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const button = () => w.findAll('button').find((b) => /Restart|Reconnect|Connect/.test(b.text()))!;
    FakeSocket.instances[0]!.open();
    await flushPromises();
    expect(button().text()).toBe('Restart');

    await button().trigger('click');
    await flushPromises();
    expect(FakeSocket.instances).toHaveLength(2); // a fresh socket was opened

    FakeSocket.instances[1]!.serverClose(1000, '', true);
    await flushPromises();
    expect(button().text()).toBe('Reconnect');
  });

  it('the shell field is editable once connected, and used on the next connect', async () => {
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    FakeSocket.instances[0]!.open();
    await flushPromises();

    const shellInput = w.find('.shell-input');
    expect(shellInput.attributes('disabled')).toBeUndefined(); // not locked while open

    await shellInput.setValue('bash');
    await w.findAll('button').find((b) => b.text() === 'Restart')!.trigger('click');
    await flushPromises();

    const url = new URL(FakeSocket.instances[1]!.url);
    expect(url.searchParams.get('command')).toBe('bash');
  });

  it('disconnects the socket and disposes the terminal on unmount', async () => {
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    const sock = FakeSocket.instances[0]!;
    sock.open();
    await flushPromises();
    const term = lastTerm!;
    w.unmount();
    expect(sock.readyState).toBe(FakeSocket.CLOSED);
    expect(term.disposed).toBe(true);
  });

  it('shows a message when the xterm CDN library failed to load, and does not connect', async () => {
    uninstallFakeXterm();
    const w = mount(ContainerTerminal, { props: props() });
    await flushPromises();
    expect(w.text()).toContain('could not be loaded');
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
