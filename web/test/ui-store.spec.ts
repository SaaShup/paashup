import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore } from '../src/stores/ui';

const containers = {
  endpoint: '/api/plugins/docker/containers/',
  table: 'plugin_docker_container',
  section: 'docker',
  label: 'Containers',
  writable: true,
  order: 0,
} as never;

describe('ui store: openResourceFiltered', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('opens the resource list and stashes the one-shot filters', () => {
    const ui = useUiStore();
    ui.openResourceFiltered(containers, { host: '7' });
    expect(ui.view).toBe('list');
    expect(ui.selected?.table).toBe('plugin_docker_container');
    expect(ui.pendingFilters).toEqual({ host: '7' });
    expect(ui.detailId).toBeNull(); // not a detail navigation
  });

  it('a plain openResource leaves no pending filters', () => {
    const ui = useUiStore();
    ui.openResource(containers);
    expect(ui.pendingFilters).toBeNull();
  });
});
