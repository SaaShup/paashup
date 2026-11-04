import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import ObjectDetailView from '../src/views/ObjectDetailView.vue';

const OPENSTACK_SERVERS = '/api/plugins/openstack/servers/';
const VM_ENDPOINT = '/api/virtualization/virtual-machines/';
const VM_TABLE = 'virtualization_virtual_machine';

const fixture = (name = 'web-1') => ({
  id: 1,
  name,
  display: name,
  status: { value: 'active', label: 'Active' },
  vcpus: 2,
  memory: 7168,
  disk: 50,
});

// ObjectForm owns the real field-by-field editing UI (fetches the schema, renders inputs for
// every writable field, PATCHes on its own). That's exercised in its own tests; here we only
// care what ObjectDetailView does once it reports success, so it's stubbed to just emit it.
const stubs = {
  ObjectForm: {
    name: 'ObjectForm',
    props: ['model', 'endpoint', 'object'],
    emits: ['saved', 'cancel'],
    template: '<div class="stub-form" />',
  },
};

function emitSaved(w: ReturnType<typeof mount>): void {
  const form = w.findComponent({ name: 'ObjectForm' } as never) as unknown as {
    vm: { $emit: (event: string) => void };
  };
  form.vm.$emit('saved');
}

function mountDetail() {
  setActivePinia(createPinia());
  const ui = useUiStore();
  const resource = {
    endpoint: VM_ENDPOINT,
    table: VM_TABLE,
    section: 'virtualization',
    label: 'Virtual machines',
    model: 'VirtualMachine',
    writable: true,
    order: 0,
  };
  ui.resources = [resource] as never;
  ui.openDetail(resource as never, 1);
  return mount(ObjectDetailView, { global: { stubs } });
}

describe('VM rename sync to OpenStack (ObjectDetailView)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'list').mockImplementation(async (endpoint: string) => {
      if (endpoint === OPENSTACK_SERVERS) {
        return { count: 1, next: null, previous: null, results: [{ cloud: 'ovh' }] } as never;
      }
      return { count: 0, next: null, previous: null, results: [] } as never;
    });
    vi.spyOn(api, 'get').mockResolvedValue({ metadata: {} } as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a name change after Edit/Save is pushed to OpenStack', async () => {
    vi.spyOn(api, 'retrieve')
      .mockResolvedValueOnce(fixture('web-1') as never)
      .mockResolvedValue(fixture('web-1-renamed') as never);
    const put = vi.spyOn(api, 'put').mockResolvedValue({} as never);

    const w = mountDetail();
    await flushPromises();

    await w
      .findAll('button')
      .find((b) => b.text() === 'Edit')!
      .trigger('click');
    emitSaved(w);
    await flushPromises();

    expect(put).toHaveBeenCalledWith(`${OPENSTACK_SERVERS}1/rename/`, {
      name: 'web-1-renamed',
    });
  });

  it('saving without a name change does not touch OpenStack', async () => {
    vi.spyOn(api, 'retrieve').mockResolvedValue(fixture('web-1') as never);
    const put = vi.spyOn(api, 'put').mockResolvedValue({} as never);

    const w = mountDetail();
    await flushPromises();

    await w
      .findAll('button')
      .find((b) => b.text() === 'Edit')!
      .trigger('click');
    emitSaved(w);
    await flushPromises();

    expect(put).not.toHaveBeenCalled();
  });

  it('a VM not backed by an OpenStack server never gets a rename push', async () => {
    vi.spyOn(api, 'list').mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    } as never); // no OpenStack server behind this VM
    vi.spyOn(api, 'retrieve')
      .mockResolvedValueOnce(fixture('bare-vm') as never)
      .mockResolvedValue(fixture('bare-vm-renamed') as never);
    const put = vi.spyOn(api, 'put').mockResolvedValue({} as never);

    const w = mountDetail();
    await flushPromises();

    await w
      .findAll('button')
      .find((b) => b.text() === 'Edit')!
      .trigger('click');
    emitSaved(w);
    await flushPromises();

    expect(put).not.toHaveBeenCalled();
  });

  it('a failed rename push is surfaced as an error, without undoing the local rename', async () => {
    vi.spyOn(api, 'retrieve')
      .mockResolvedValueOnce(fixture('web-1') as never)
      .mockResolvedValue(fixture('web-1-renamed') as never);
    vi.spyOn(api, 'put').mockRejectedValue(new Error('network down'));

    const w = mountDetail();
    await flushPromises();

    await w
      .findAll('button')
      .find((b) => b.text() === 'Edit')!
      .trigger('click');
    emitSaved(w);
    await flushPromises();

    expect(w.text()).toContain("Renamed in paashup, but OpenStack wasn't updated");
    expect(w.text()).toContain('web-1-renamed'); // the local rename still shows
  });
});
