// Coverage for the Docker network `subnet` UX in ObjectForm: a select of popular private
// ranges (filtered to exclude ones already used by another network on the same host) plus
// "Other (IPv4/IPv6)…", which reveals a free-entry input validated against the chosen
// family — and the `driver` field locked to "bridge" (Docker only ever lets you *create*
// a bridge network; host/none are its own built-in singletons).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import ObjectForm from '../src/components/ObjectForm.vue';

const ENDPOINT = '/api/plugins/docker/networks/';
const TABLE = 'plugin_docker_network';

const SCHEMA_DOC = {
  paths: {},
  components: {
    schemas: {
      DockerNetworkRequest: {
        required: ['host', 'name'],
        properties: {
          host: { type: 'integer' },
          name: { type: 'string' },
          driver: {
            type: 'string',
            enum: ['bridge', 'host', 'none'],
            'x-form-readonly': true,
            'x-form-default': 'bridge',
          },
          subnet: { type: 'string', nullable: true },
        },
      },
      DockerNetwork: {
        properties: {
          host: { type: 'integer' },
          name: { type: 'string' },
          driver: { type: 'string' },
          subnet: { type: 'string', nullable: true },
        },
      },
    },
  },
};

function mountForm(object: Record<string, unknown> | null = null, defaults?: Record<string, unknown>) {
  setActivePinia(createPinia());
  const ui = useUiStore();
  ui.resources = [
    {
      endpoint: ENDPOINT,
      table: TABLE,
      section: 'plugins',
      label: 'Networks',
      model: 'DockerNetwork',
      writable: true,
      order: 0,
    },
  ] as never;
  return mount(ObjectForm, {
    props: { model: 'DockerNetwork', endpoint: ENDPOINT, object, defaults },
    attachTo: document.body,
  });
}

/** The `.row` for one field, found by its (unique) label prefix. */
function rowFor(w: VueWrapper, field: string) {
  const row = w.findAll('.row').find((r) => r.find('label').text().startsWith(field));
  if (!row) throw new Error(`No row for field "${field}"`);
  return row;
}

/** Networks already on host 1: one on 172.30.0.0/16 (used in the duplicate-rejection tests). */
function mockSiblingNetworks() {
  return vi.spyOn(api, 'list').mockImplementation(async (ep: string, params?: Record<string, unknown>) => {
    if (ep === ENDPOINT && params?.host_id === '1') {
      return {
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 99, subnet: '172.30.0.0/16' }],
      } as never;
    }
    return { count: 0, next: null, previous: null, results: [] } as never;
  });
}

describe('ObjectForm: Docker network driver is locked to "bridge"', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows driver as read-only text, prefilled "bridge", not a select', async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const w = mountForm(null, { host: 1 });
    await flushPromises();
    const row = rowFor(w, 'driver');
    expect(row.find('select').exists()).toBe(false);
    expect(row.text()).toContain('bridge');
  });
});

describe('ObjectForm: Docker network subnet select + custom entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('defaults to "Auto" (blank subnet), with every preset offered', async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const w = mountForm(null, { host: 2 }); // a host with no existing networks mocked
    await flushPromises();
    const row = rowFor(w, 'subnet');
    const select = row.find('select');
    expect((select.element as HTMLSelectElement).value).toBe('');
    expect(select.find('option[value=""]').text()).toBe('Auto');
    expect(select.text()).toContain('172.16.0.0/16 (IPv4)');
    expect(select.text()).toContain('fd00:1::/64 (IPv6)');
  });

  it("excludes a preset already used by another network on the same host, but not others", async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const w = mountForm(null, { host: 1 });
    await flushPromises();
    const options = rowFor(w, 'subnet')
      .findAll('option')
      .map((o) => o.text());
    expect(options).not.toContain('172.30.0.0/16 (IPv4)');
    expect(options).toContain('172.16.0.0/16 (IPv4)');
  });

  it('picking a preset submits it directly, no free-entry input shown', async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm(null, { host: 2 });
    await flushPromises();
    const row = rowFor(w, 'subnet');
    await row.find('select').setValue('10.10.0.0/16');
    expect(row.find('input[type="text"]').exists()).toBe(false);
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ subnet: '10.10.0.0/16' }));
  });

  it('"Other (IPv4)…" reveals a free input; an invalid CIDR (host bits set) is rejected live', async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm(null, { host: 2 });
    await flushPromises();
    const row = rowFor(w, 'subnet');
    await row.find('select').setValue('__custom_v4__');
    const input = row.find('input[type="text"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes('placeholder')).toBe('172.30.0.0/16');

    await input.setValue('172.35.0.1/16'); // valid IP, but not a network address
    expect(input.classes()).toContain('invalid');
    expect(row.text()).toContain('IPv4 network address');

    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
  });

  it('"Other (IPv6)…" rejects an IPv4 value typed into it', async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const w = mountForm(null, { host: 2 });
    await flushPromises();
    const row = rowFor(w, 'subnet');
    await row.find('select').setValue('__custom_v6__');
    const input = row.find('input[type="text"]');
    expect(input.attributes('placeholder')).toBe('fd00:1::/64');
    await input.setValue('172.30.0.0/16');
    expect(input.classes()).toContain('invalid');
    expect(row.text()).toContain('IPv6');
  });

  it('a valid, unused custom subnet submits and shows no error', async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm(null, { host: 2 });
    await flushPromises();
    const row = rowFor(w, 'subnet');
    await row.find('select').setValue('__custom_v4__');
    await row.find('input[type="text"]').setValue('192.168.50.0/24');
    expect(row.find('input[type="text"]').classes()).not.toContain('invalid');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ subnet: '192.168.50.0/24' }),
    );
  });

  it('rejects a custom subnet already used by another network on the same host, and blocks submit', async () => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    mockSiblingNetworks();
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm(null, { host: 1 });
    await flushPromises();
    const row = rowFor(w, 'subnet');
    await row.find('select').setValue('__custom_v4__');
    await row.find('input[type="text"]').setValue('172.30.0.0/16'); // already used, per the mock
    expect(row.text()).toContain('already used by another network on this host');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
  });
});
