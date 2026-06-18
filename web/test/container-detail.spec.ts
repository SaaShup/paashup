import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import ContainerDetailView from '../src/views/ContainerDetailView.vue';
import { scalarText, cellText, rowsOf, CONTAINER_COLLECTIONS } from '../src/views/containerDetail';

// A representative GET /containers/{id}/ payload (host/image briefs + the nine child arrays;
// some collections deliberately empty). Mirrors serialize.ts output.
const fixture = {
  id: 1,
  name: 'web-demo',
  display: 'web-demo',
  state: 'running',
  status: 'Up 3 hours',
  operation: 'none',
  restart_policy: { value: 'always', label: 'always' }, // choice object, not plain
  hostname: 'web',
  ContainerID: 'abc123',
  cap_add: [],
  cap_drop: [],
  log_driver: 'json-file',
  pid_mode: '',
  secOpt: [],
  extra_hosts: [],
  cmd: '',
  host: { id: 2, display: 'host-002' },
  image: { id: 3, display: 'nginx' },
  env: [{ var_name: 'FOO', value: 'bar' }],
  labels: [],
  mounts: [{ source: '/data', volume: { id: 5, display: 'vol1' }, read_only: true }],
  network_settings: [{ network: { id: 7, display: 'net1' } }],
  binds: [],
  log_driver_options: [],
  sysctls: [],
  devices: [],
  ports: [{ public_port: 8080, private_port: 80, type: 'tcp' }],
};

describe('containerDetail helpers', () => {
  it('scalarText resolves choices, briefs, arrays and blanks', () => {
    expect(scalarText('running')).toBe('running');
    expect(scalarText({ value: 'always', label: 'always' })).toBe('always');
    expect(scalarText({ id: 2, display: 'host-002' })).toBe('host-002');
    expect(scalarText([])).toBe('—');
    expect(scalarText(null)).toBe('—');
  });

  it('cellText handles FK and boolean columns', () => {
    expect(cellText({ id: 5, display: 'vol1' }, { key: 'volume', label: 'V', fk: true })).toBe(
      'vol1',
    );
    expect(cellText(true, { key: 'read_only', label: 'RO', bool: true })).toBe('✓');
    expect(cellText(false, { key: 'read_only', label: 'RO', bool: true })).toBe('✗');
  });

  it('rowsOf always returns an array', () => {
    expect(rowsOf(fixture, 'env')).toHaveLength(1);
    expect(rowsOf(fixture, 'missing')).toEqual([]);
  });

  it('defines all nine collections', () => {
    expect(CONTAINER_COLLECTIONS.map((c) => c.field).sort()).toEqual([
      'binds',
      'devices',
      'env',
      'labels',
      'log_driver_options',
      'mounts',
      'network_settings',
      'ports',
      'sysctls',
    ]);
  });
});

function mountDetail() {
  setActivePinia(createPinia());
  const ui = useUiStore();
  ui.resources = [
    {
      endpoint: '/api/plugins/docker/hosts/',
      table: 'plugin_docker_host',
      section: 'docker',
      label: 'Hosts',
      writable: true,
      order: 0,
    },
    {
      endpoint: '/api/plugins/docker/images/',
      table: 'plugin_docker_image',
      section: 'docker',
      label: 'Images',
      writable: true,
      order: 0,
    },
  ] as never;
  ui.openDetail(
    {
      endpoint: '/api/plugins/docker/containers/',
      table: 'plugin_docker_container',
      section: 'docker',
      label: 'Containers',
      model: 'DockerContainer',
      writable: true,
      order: 0,
    } as never,
    1,
  );
  return mount(ContainerDetailView);
}

describe('ContainerDetailView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'retrieve').mockResolvedValue(fixture as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the container scalar properties', async () => {
    const w = mountDetail();
    await flushPromises();
    const t = w.text();
    expect(t).toContain('web-demo'); // name/title
    expect(t).toContain('running'); // state
    expect(t).toContain('always'); // restart_policy → label, not the {value,label} object
    expect(t).toContain('abc123'); // ContainerID
  });

  it('renders FK references as readable names, not ids', async () => {
    const w = mountDetail();
    await flushPromises();
    const t = w.text();
    expect(t).toContain('host-002'); // host brief
    expect(t).toContain('nginx'); // image brief
    expect(t).toContain('vol1'); // mount volume FK
    expect(t).toContain('net1'); // network FK
  });

  it('renders each non-empty collection row', async () => {
    const w = mountDetail();
    await flushPromises();
    const t = w.text();
    expect(t).toContain('FOO'); // env var_name
    expect(t).toContain('bar'); // env value
    expect(t).toContain('8080'); // port public
    expect(t).toContain('tcp'); // port type
    expect(t).toContain('✓'); // mount read_only = true
  });

  it('shows an empty state for empty collections', async () => {
    const w = mountDetail();
    await flushPromises();
    const t = w.text();
    expect(t).toContain('No labels');
    expect(t).toContain('No binds');
    expect(t).toContain('No sysctls');
  });
});
