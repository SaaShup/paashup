import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore } from '../src/stores/ui';
import { api } from '../src/api/client';
import type { Resource } from '../src/api/resources';
import type { ChangeEvent } from '../src/websocket/events';

vi.mock('../src/api/client', () => ({
  api: { list: vi.fn() },
}));

const containers: Resource = {
  endpoint: '/api/plugins/docker/containers/',
  table: 'plugin_docker_container',
  section: 'docker',
  label: 'Containers',
  writable: true,
  order: 0,
};

describe('ui store: openResourceFiltered', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('opens the resource list and keeps the filters', () => {
    const ui = useUiStore();
    ui.openResourceFiltered(containers, { host: '7' });
    expect(ui.view).toBe('list');
    expect(ui.selected?.table).toBe('plugin_docker_container');
    expect(ui.filters).toEqual({ host: '7' });
    expect(ui.detailId).toBeNull(); // not a detail navigation
  });

  it('a plain openResource leaves no filters', () => {
    const ui = useUiStore();
    ui.openResource(containers);
    expect(ui.filters).toEqual({});
  });
});

describe('ui store: resyncCountsAfterBulkChange', () => {
  const hosts: Resource = {
    endpoint: '/api/plugins/docker/hosts/',
    table: 'plugin_docker_host',
    section: 'docker',
    label: 'Hosts',
    writable: true,
    order: 0,
  };

  const hostEvent = (event: 'updated' | 'deleted', state?: string): ChangeEvent => ({
    type: 'change',
    event,
    object_type: 'plugin_docker.host',
    table: 'plugin_docker_host',
    id: 1,
    ...(state ? { data: { state } } : {}),
  });

  let ui: ReturnType<typeof useUiStore>;
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.list).mockReset().mockResolvedValue({ count: 3, results: [] } as never);
    ui = useUiStore();
    ui.setResources([hosts, containers]);
  });

  it('a host starting to refresh re-fetches the other docker tables', async () => {
    ui.counts = { plugin_docker_host: 1, plugin_docker_container: 12 };
    await ui.resyncCountsAfterBulkChange(hostEvent('updated', 'refreshing'));
    expect(ui.counts).toEqual({ plugin_docker_host: 1, plugin_docker_container: 3 });
  });

  it('a host deletion re-fetches too', async () => {
    await ui.resyncCountsAfterBulkChange(hostEvent('deleted'));
    expect(api.list).toHaveBeenCalledWith(containers.endpoint, { limit: 1 });
  });

  it('any other event is ignored', async () => {
    await ui.resyncCountsAfterBulkChange(hostEvent('updated', 'running'));
    await ui.resyncCountsAfterBulkChange({
      ...hostEvent('updated', 'refreshing'),
      table: 'plugin_docker_container', 
    });
    expect(api.list).not.toHaveBeenCalled();
  });
});
