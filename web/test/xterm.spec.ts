// Pure-logic pieces of the xterm.js glue used by the container Logs/Terminal panels:
// CDN-availability detection, Docker log-frame cleanup, and the fullscreen helpers.
// `Terminal`/`FitAddon` are ambient globals (loaded from a CDN in index.html, see
// xterm-globals.d.ts), so tests that need them install fakes on `globalThis` and remove
// them afterwards.
import { describe, it, expect, afterEach } from 'vitest';
import {
  hasXterm,
  openTerminal,
  safeFit,
  stripDockerFrames,
  crlf,
  fullscreenSupported,
  isFullscreen,
  toggleFullscreen,
} from '../src/xterm';

function installFakeXterm() {
  const opened: unknown[] = [];
  const loadedAddons: unknown[] = [];
  const fitCalls: number[] = [];
  class FakeTerminal {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    open(el: HTMLElement) {
      opened.push(el);
    }
    loadAddon(addon: unknown) {
      loadedAddons.push(addon);
    }
  }
  class FakeFitAddon {
    fit() {
      fitCalls.push(1);
    }
  }
  (globalThis as Record<string, unknown>).Terminal = FakeTerminal;
  (globalThis as Record<string, unknown>).FitAddon = { FitAddon: FakeFitAddon };
  return { opened, loadedAddons, fitCalls, FakeTerminal, FakeFitAddon };
}
function uninstallFakeXterm() {
  delete (globalThis as Record<string, unknown>).Terminal;
  delete (globalThis as Record<string, unknown>).FitAddon;
}

describe('hasXterm', () => {
  afterEach(uninstallFakeXterm);

  it('is false when the CDN globals are absent', () => {
    expect(hasXterm()).toBe(false);
  });

  it('is true once Terminal and FitAddon are both defined', () => {
    installFakeXterm();
    expect(hasXterm()).toBe(true);
  });
});

describe('openTerminal', () => {
  afterEach(uninstallFakeXterm);

  it('constructs a Terminal with the shared theme, loads the fit addon, opens it, and fits once', () => {
    const fake = installFakeXterm();
    const el = document.createElement('div');
    const { term, fit } = openTerminal(el, { cursorBlink: true });
    expect(term).toBeInstanceOf(fake.FakeTerminal);
    expect(fit).toBeInstanceOf(fake.FakeFitAddon);
    expect((term as unknown as { options: Record<string, unknown> }).options).toMatchObject({
      cursorBlink: true,
      fontFamily: expect.stringContaining('monospace'),
    });
    expect(fake.opened).toEqual([el]);
    expect(fake.loadedAddons).toEqual([fit]);
    expect(fake.fitCalls).toHaveLength(1); // fitted once on open
  });
});

describe('safeFit', () => {
  it('swallows a fit() thrown while the element has no layout (hidden tab)', () => {
    const fit = {
      fit: () => {
        throw new Error('not laid out');
      },
    };
    expect(() => safeFit(fit as never)).not.toThrow();
  });

  it('calls through when fit() succeeds', () => {
    let called = false;
    safeFit({ fit: () => (called = true) } as never);
    expect(called).toBe(true);
  });
});

describe('stripDockerFrames', () => {
  it('removes the 8-byte multiplexed-stream frame header before a line', () => {
    // stdout stream (1), 3 NUL padding bytes, then a 4-byte length — here for "hi\n" (3 bytes)
    const header = '\x01\x00\x00\x00\x00\x00\x00\x03';
    expect(stripDockerFrames(`${header}hi\n`)).toBe('hi\n');
  });

  it('strips a header on each of several lines', () => {
    const h = (n: string) => `\x01\x00\x00\x00${n}`;
    const text = `${h('\x00\x00\x00\x06')}first\n${h('\x00\x00\x00\x07')}second\n`;
    expect(stripDockerFrames(text)).toBe('first\nsecond\n');
  });

  it('leaves plain text without headers untouched', () => {
    expect(stripDockerFrames('no headers here\nsecond line\n')).toBe('no headers here\nsecond line\n');
  });

  it('leaves an empty string untouched', () => {
    expect(stripDockerFrames('')).toBe('');
  });
});

describe('crlf', () => {
  it('converts bare LF to CRLF', () => {
    expect(crlf('a\nb\nc')).toBe('a\r\nb\r\nc');
  });

  it('does not double up an existing CRLF', () => {
    expect(crlf('a\r\nb')).toBe('a\r\nb');
  });

  it('handles mixed line endings', () => {
    expect(crlf('a\r\nb\nc')).toBe('a\r\nb\r\nc');
  });
});

describe('fullscreen helpers', () => {
  afterEach(() => {
    delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
    delete (document as unknown as Record<string, unknown>).exitFullscreen;
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('fullscreenSupported reflects whether the browser exposes the API', () => {
    expect(fullscreenSupported()).toBe(false);
    document.documentElement.requestFullscreen = () => Promise.resolve();
    expect(fullscreenSupported()).toBe(true);
  });

  it('isFullscreen compares against document.fullscreenElement', () => {
    const el = document.createElement('section');
    expect(isFullscreen(el)).toBe(false);
    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
    expect(isFullscreen(el)).toBe(true);
  });

  it('toggleFullscreen is a no-op when the API is unavailable', async () => {
    const el = document.createElement('section');
    await expect(toggleFullscreen(el)).resolves.toBeUndefined();
  });

  it('toggleFullscreen requests fullscreen when not active, and exits when active', async () => {
    const el = document.createElement('section');
    let requested = 0;
    let exited = 0;
    el.requestFullscreen = () => {
      requested++;
      return Promise.resolve();
    };
    document.exitFullscreen = () => {
      exited++;
      return Promise.resolve();
    };
    document.documentElement.requestFullscreen = () => Promise.resolve();

    await toggleFullscreen(el);
    expect(requested).toBe(1);
    expect(exited).toBe(0);

    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
    await toggleFullscreen(el);
    expect(exited).toBe(1);
  });

  it('swallows a rejection (denied without a user gesture)', async () => {
    const el = document.createElement('section');
    document.documentElement.requestFullscreen = () => Promise.resolve();
    el.requestFullscreen = () => Promise.reject(new Error('denied'));
    await expect(toggleFullscreen(el)).resolves.toBeUndefined();
  });
});
