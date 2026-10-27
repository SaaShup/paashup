// ContainerLogs.vue: fetches the agent's logs through the paashup proxy and renders them
// in a (faked) xterm.js pane. `Terminal`/`FitAddon` are ambient CDN globals — a fake is
// installed on `globalThis` for each test — and `ResizeObserver` is stubbed since jsdom
// doesn't implement it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { api, ApiError } from '../src/api/client';
import ContainerLogs from '../src/components/ContainerLogs.vue';

class FakeTerm {
  written: string[] = [];
  disposed = false;
  scrolledToBottom = 0;
  loadAddon(_addon: unknown) {}
  write(data: string, cb?: () => void) {
    this.written.push(data);
    cb?.();
  }
  reset() {
    this.written = [];
  }
  scrollToBottom() {
    this.scrolledToBottom++;
  }
  dispose() {
    this.disposed = true;
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
    open() {}
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

describe('ContainerLogs', () => {
  beforeEach(() => {
    installFakeXterm();
    lastTerm = null;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    uninstallFakeXterm();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the "unavailable" message and never calls the proxy when there is no ContainerID', async () => {
    const get = vi.spyOn(api, 'get');
    const w = mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: null },
    });
    await flushPromises();
    expect(w.text()).toContain('logs are unavailable');
    expect(get).not.toHaveBeenCalled();
    expect(w.find('[data-testid="logs"]').isVisible()).toBe(false);
  });

  it('fetches and renders the logs as soon as it is mounted (no click needed)', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue('line one\nline two\n' as never);
    const w = mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
    });
    await flushPromises();
    expect(get).toHaveBeenCalledWith('/api/plugins/docker/containers/1/logs/');
    expect(lastTerm?.written.join('')).toContain('line two');
    expect(w.text()).not.toContain('Loading logs');
  });

  it('shows a placeholder for an empty (but successful) log fetch', async () => {
    vi.spyOn(api, 'get').mockResolvedValue('' as never);
    mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
    });
    await flushPromises();
    expect(lastTerm?.written.join('')).toContain('(no output)');
  });

  it('strips Docker multiplex frame headers before writing to the terminal', async () => {
    const header = '\x01\x00\x00\x00\x00\x00\x00\x03';
    vi.spyOn(api, 'get').mockResolvedValue(`${header}hi\n` as never);
    mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
    });
    await flushPromises();
    expect(lastTerm?.written.join('')).toBe('hi\n');
  });

  it('Refresh re-fetches on demand', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue('v1\n' as never);
    const w = mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
    });
    await flushPromises();
    get.mockResolvedValue('v2\n' as never);
    await w.find('button').trigger('click'); // Refresh is the first button (no Follow toggle btn)
    await flushPromises();
    expect(get).toHaveBeenCalledTimes(2);
    expect(lastTerm?.written.join('')).toContain('v2');
  });

  it('a failed fetch shows the agent error text instead of the pane', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(502, 'connect ECONNREFUSED'));
    const w = mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
    });
    await flushPromises();
    expect(w.text()).toContain('connect ECONNREFUSED');
    expect(w.find('[data-testid="logs"]').isVisible()).toBe(false);
  });

  it('Follow polls on an interval and stops when unchecked', async () => {
    vi.useFakeTimers();
    try {
      const get = vi.spyOn(api, 'get').mockResolvedValue('tick\n' as never);
      const w = mount(ContainerLogs, {
        props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
      });
      await flushPromises();
      expect(get).toHaveBeenCalledTimes(1); // the initial load on mount

      await w.find('.follow input').setValue(true);
      await flushPromises();
      expect(get).toHaveBeenCalledTimes(2); // Follow fetches immediately too

      await vi.advanceTimersByTimeAsync(3000);
      expect(get).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3000);
      expect(get).toHaveBeenCalledTimes(4);

      await w.find('.follow input').setValue(false);
      await vi.advanceTimersByTimeAsync(10000);
      expect(get).toHaveBeenCalledTimes(4); // no more polling once unchecked
    } finally {
      vi.useRealTimers();
    }
  });

  it('the Follow checkbox is disabled without a ContainerID', async () => {
    const w = mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: null },
    });
    await flushPromises();
    expect(w.find('.follow input').attributes('disabled')).toBeDefined();
  });

  it('disposes the terminal and stops polling on unmount', async () => {
    vi.useFakeTimers();
    try {
      const get = vi.spyOn(api, 'get').mockResolvedValue('x\n' as never);
      const w = mount(ContainerLogs, {
        props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
      });
      await flushPromises();
      await w.find('.follow input').setValue(true);
      await flushPromises();
      const calls = get.mock.calls.length;
      const term = lastTerm!;
      w.unmount();
      await vi.advanceTimersByTimeAsync(10000);
      expect(get.mock.calls.length).toBe(calls); // polling stopped
      expect(term.disposed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a message when the xterm CDN library failed to load', async () => {
    uninstallFakeXterm(); // simulate the CDN being unreachable
    vi.spyOn(api, 'get').mockResolvedValue('hi\n' as never);
    const w = mount(ContainerLogs, {
      props: { path: '/api/plugins/docker/containers/1/logs/', containerId: 'cid-1' },
    });
    await flushPromises();
    expect(w.text()).toContain('could not be loaded');
  });
});
