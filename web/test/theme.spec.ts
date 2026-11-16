// theme.ts keeps its state in module-level singletons (the `theme` ref, applied immediately
// via a watcher), so each test re-imports it fresh via vi.resetModules() to get an isolated
// read of localStorage / the <html> attribute instead of whatever a previous test left behind.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

async function freshTheme() {
  vi.resetModules();
  return import('../src/theme');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('defaults to light, with no data-theme attribute, when nothing is stored', async () => {
    const { theme } = await freshTheme();
    expect(theme.value).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('picks up a previously stored dark-cb theme and applies it on load', async () => {
    localStorage.setItem('pb_theme', 'dark-cb');
    const { theme } = await freshTheme();
    expect(theme.value).toBe('dark-cb');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark-cb');
  });

  it('treats an unrecognized stored value as light', async () => {
    localStorage.setItem('pb_theme', 'solarized');
    const { theme } = await freshTheme();
    expect(theme.value).toBe('light');
  });

  it('setTheme updates the attribute and persists the choice', async () => {
    const { theme, setTheme } = await freshTheme();

    setTheme('dark-cb');
    expect(theme.value).toBe('dark-cb');
    await nextTick(); // the theme watcher (DOM attribute + localStorage) flushes async
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark-cb');
    expect(localStorage.getItem('pb_theme')).toBe('dark-cb');

    setTheme('light');
    await nextTick();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('pb_theme')).toBe('light');
  });

  it('THEMES lists exactly light and dark-cb, each with an icon and a label', async () => {
    const { THEMES } = await freshTheme();
    expect(THEMES.map((t) => t.id)).toEqual(['light', 'dark-cb']);
    for (const t of THEMES) {
      expect(t.icon).toBeTruthy();
      expect(t.label).toBeTruthy();
    }
  });
});
