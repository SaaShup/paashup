import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import { answerConfirm } from '../src/composables/confirm';
import ObjectDetailView from '../src/views/ObjectDetailView.vue';

const OPENSTACK_SERVERS = '/api/plugins/openstack/servers/';
const VM_ENDPOINT = '/api/virtualization/virtual-machines/';
const VM_TABLE = 'virtualization_virtual_machine';

const fixture = () => ({
  id: 1,
  name: 'web-1',
  display: 'web-1',
  status: { value: 'active', label: 'Active' },
  vcpus: 2,
  memory: 7168,
  disk: 50,
});

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
  return mount(ObjectDetailView);
}

describe('VM delete on OpenStack (ObjectDetailView)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'retrieve').mockResolvedValue(fixture() as never);
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
    answerConfirm({ ok: false, checked: false }); // never leave a dialog pending across tests
  });

  it('leaving the checkbox unchecked deletes the server but keeps its volume(s)', async () => {
    const del = vi.spyOn(api, 'del').mockResolvedValue({} as never);
    const w = mountDetail();
    await flushPromises();

    const clicked = w
      .findAll('button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click');
    answerConfirm({ ok: true, checked: false });
    await clicked;
    await flushPromises();

    expect(del).toHaveBeenCalledWith(`${OPENSTACK_SERVERS}1/`, { delete_volumes: false });
  });

  it('checking the box also deletes the data volume(s)', async () => {
    const del = vi.spyOn(api, 'del').mockResolvedValue({} as never);
    const w = mountDetail();
    await flushPromises();

    const clicked = w
      .findAll('button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click');
    answerConfirm({ ok: true, checked: true });
    await clicked;
    await flushPromises();

    expect(del).toHaveBeenCalledWith(`${OPENSTACK_SERVERS}1/`, { delete_volumes: true });
  });

  it('cancelling the confirmation sends nothing', async () => {
    const del = vi.spyOn(api, 'del').mockResolvedValue({} as never);
    const w = mountDetail();
    await flushPromises();

    const clicked = w
      .findAll('button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click');
    answerConfirm({ ok: false, checked: false });
    await clicked;
    await flushPromises();

    expect(del).not.toHaveBeenCalled();
  });
});
