import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import ContainerDetailView from '../src/views/ContainerDetailView.vue';
import {
  scalarText,
  cellText,
  rowsOf,
  CONTAINER_COLLECTIONS,
  draftRows,
  blankRow,
  collectionPayload,
} from '../src/views/containerDetail';

const collection = (field: string) => CONTAINER_COLLECTIONS.find((c) => c.field === field)!;

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

  it('draftRows flattens FK briefs to ids and coerces booleans', () => {
    expect(draftRows(fixture, collection('mounts'))).toEqual([
      { source: '/data', volume: 5, read_only: true },
    ]);
    expect(draftRows(fixture, collection('ports'))).toEqual([
      { public_port: 8080, private_port: 80, type: 'tcp' },
    ]);
  });

  it('collectionPayload converts numbers/FKs, trims, and drops empty rows', () => {
    const ports = collection('ports');
    expect(collectionPayload(ports, [{ public_port: '8081', private_port: '81', type: '' }])).toEqual(
      [{ public_port: 8081, private_port: 81 }], 
    );
    expect(collectionPayload(ports, [blankRow(ports)])).toEqual([]);
    const mounts = collection('mounts');
    expect(
      collectionPayload(mounts, [{ source: ' /data ', volume: 5, read_only: false }]),
    ).toEqual([{ source: '/data', volume: 5, read_only: false }]);
    expect(collectionPayload(mounts, [blankRow(mounts)])).toEqual([]); 
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

  const editorOf = (w: ReturnType<typeof mountDetail>, field: string) =>
    w.findAll('section.editor')[CONTAINER_COLLECTIONS.findIndex((c) => c.field === field)]!;

  it('renders every collection as an inline editor with the row values', async () => {
    const w = mountDetail();
    await flushPromises();
    expect(w.findAll('section.editor')).toHaveLength(CONTAINER_COLLECTIONS.length);
    const inputVals = (field: string) =>
      editorOf(w, field)
        .findAll('input')
        .map((i) => (i.element as HTMLInputElement).value);
    expect(inputVals('env')).toEqual(['FOO', 'bar']);
    expect(inputVals('ports')).toEqual(['8080', '80']);
    const typeSel = editorOf(w, 'ports').find('select');
    expect((typeSel.element as HTMLSelectElement).value).toBe('tcp');
    const volSel = editorOf(w, 'mounts').find('select');
    expect((volSel.element as HTMLSelectElement).value).toBe('5');
    expect(volSel.text()).toContain('vol1');
    const ro = editorOf(w, 'mounts').find('input[type="checkbox"]');
    expect((ro.element as HTMLInputElement).checked).toBe(true);
  });

  it('env editor: Save PATCHes the container with the edited env array', async () => {
    const update = vi.spyOn(api, 'update').mockResolvedValue(fixture as never);
    const w = mountDetail();
    await flushPromises();
    // edit the value of the one existing env row, then Save
    const env = editorOf(w, 'env');
    await env.findAll('input')[1]!.setValue('baz');
    const save = env.findAll('button').find((b) => b.text() === 'Save')!;
    await save.trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('/api/plugins/docker/containers/', 1, {
      env: [{ var_name: 'FOO', value: 'baz' }],
    });
  });

  it('ports editor: added row is sent with numeric ports', async () => {
    const update = vi.spyOn(api, 'update').mockResolvedValue(fixture as never);
    const w = mountDetail();
    await flushPromises();
    const ports = editorOf(w, 'ports');
    await ports.findAll('button').find((b) => b.text() === '+ Add')!.trigger('click');
    const inputs = ports.findAll('input');
    await inputs[2]!.setValue('9090'); 
    await inputs[3]!.setValue('90'); 
    await ports.findAll('button').find((b) => b.text() === 'Save')!.trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('/api/plugins/docker/containers/', 1, {
      ports: [
        { public_port: 8080, private_port: 80, type: 'tcp' },
        { public_port: 9090, private_port: 90 },
      ],
    });
  });

  it('mounts editor: FK id and toggled checkbox are sent typed', async () => {
    const update = vi.spyOn(api, 'update').mockResolvedValue(fixture as never);
    const w = mountDetail();
    await flushPromises();
    const mounts = editorOf(w, 'mounts');
    await mounts.find('input[type="checkbox"]').setValue(false); // read_only: true → false
    await mounts.findAll('button').find((b) => b.text() === 'Save')!.trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('/api/plugins/docker/containers/', 1, {
      mounts: [{ source: '/data', volume: 5, read_only: false }], // volume = number, not brief
    });
  });

  it('removing a row saves the shortened array', async () => {
    const update = vi.spyOn(api, 'update').mockResolvedValue(fixture as never);
    const w = mountDetail();
    await flushPromises();
    const env = editorOf(w, 'env');
    await env.findAll('button').find((b) => b.text() === '✕')!.trigger('click');
    await env.findAll('button').find((b) => b.text() === 'Save')!.trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('/api/plugins/docker/containers/', 1, { env: [] });
  });

  it('Discard resets the draft and disables Save again', async () => {
    const w = mountDetail();
    await flushPromises();
    const env = editorOf(w, 'env');
    await env.findAll('input')[1]!.setValue('changed');
    await env.findAll('button').find((b) => b.text() === 'Discard')!.trigger('click');
    expect((env.findAll('input')[1]!.element as HTMLInputElement).value).toBe('bar');
    const save = env.findAll('button').find((b) => b.text() === 'Save')!;
    expect(save.attributes('disabled')).toBeDefined();
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
