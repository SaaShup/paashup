import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore } from '../src/stores/ui';
import { pathFor, parseRoute, applyRoute } from '../src/router';

const hosts = {
  endpoint: '/api/plugins/docker/hosts/',
  table: 'plugin_docker_host',
  section: 'docker',
  label: 'Hosts',
  writable: true,
  order: 0,
} as never;

describe('router: pathFor / parseRoute round-trips', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('maps each view to a clean path and back', () => {
    const ui = useUiStore();
    ui.setResources([hosts] as never);

    ui.openDashboard();
    expect(pathFor(ui)).toBe('/');
    ui.openDocs();
    expect(pathFor(ui)).toBe('/docs');
    ui.openApiKeys();
    expect(pathFor(ui)).toBe('/api-keys');
    ui.openResource(hosts);
    expect(pathFor(ui)).toBe('/plugin_docker_host');
    ui.openDetail(hosts, 7);
    expect(pathFor(ui)).toBe('/plugin_docker_host/7');

    expect(parseRoute('/plugin_docker_host/7')).toEqual({
      view: 'detail',
      table: 'plugin_docker_host',
      id: 7,
    });
    expect(parseRoute('/plugin_docker_host')).toEqual({
      view: 'list',
      table: 'plugin_docker_host',
    });
    expect(parseRoute('/')).toEqual({ view: 'dashboard' });
    expect(parseRoute('')).toEqual({ view: 'dashboard' });
    expect(parseRoute('/plugin_docker_host/xyz')).toBeNull();
  });

  it('applyRoute restores the store state (and ignores unknown tables)', () => {
    const ui = useUiStore();
    ui.setResources([hosts] as never);

    applyRoute(ui, parseRoute('/plugin_docker_host/7'));
    expect(ui.view).toBe('detail');
    expect(ui.selected?.table).toBe('plugin_docker_host');
    expect(ui.detailId).toBe(7);

    applyRoute(ui, parseRoute('/does_not_exist'));
    expect(ui.view).toBe('detail');

    applyRoute(ui, parseRoute('/'));
    expect(ui.view).toBe('dashboard');
  });

  it('plugin pages round-trip with encoded names', () => {
    const ui = useUiStore();
    const item = { plugin: 'netbox-migrate', label: 'Migrate / Import', url: '/x' };
    ui.setPluginMenus([item] as never);
    ui.openPluginPage(item as never);
    const p = pathFor(ui);
    expect(parseRoute(p)).toEqual({
      view: 'plugin-page',
      plugin: 'netbox-migrate',
      label: 'Migrate / Import',
    });
    const ui2 = useUiStore();
    applyRoute(ui2, parseRoute(p));
    expect(ui2.pluginPage?.url).toBe('/x');
  });
});
