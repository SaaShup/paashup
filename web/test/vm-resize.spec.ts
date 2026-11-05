import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import { useConnectionStore } from '../src/stores/connection';
import ObjectDetailView from '../src/views/ObjectDetailView.vue';

const OPENSTACK_SERVERS = '/api/plugins/openstack/servers/';
const FLAVORS = '/api/plugins/openstack/clouds/5/flavors/?region=GRA9';
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
  virtual_machine_type: { id: 10, name: 'b2-7', display: 'b2-7' }, // the VM's actual current flavor
});

const FLAVOR_LIST = [
  { id: 'fl-1', name: 'b2-7', vcpus: 2, ram: 7168, disk: 50 }, // the VM's current flavor
  { id: 'fl-0', name: 'b2-7-flex', vcpus: 2, ram: 7168, disk: 50 }, // same sizes, NOT the current flavor
  { id: 'fl-2', name: 'b2-15', vcpus: 4, ram: 15360, disk: 100 },
  { id: 'fl-3', name: 'd2-2', vcpus: 1, ram: 2048, disk: 20 }, // smaller disk: can't resize to it
];

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
  return mount(ObjectDetailView, { attachTo: document.body });
}

/** The resize popup is teleported to document.body, outside the wrapper's own DOM subtree. */
const popupButtons = (): HTMLButtonElement[] => [
  ...document.body.querySelectorAll<HTMLButtonElement>('.resize-panel button'),
];
const popupButton = (text: string): HTMLButtonElement | undefined =>
  popupButtons().find((b) => b.textContent?.trim() === text);
const popupSelect = (): HTMLSelectElement | null =>
  document.body.querySelector<HTMLSelectElement>('.resize-panel select');

describe('VM resize (ObjectDetailView)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'retrieve').mockResolvedValue(fixture() as never);
    vi.spyOn(api, 'list').mockImplementation(async (endpoint: string) => {
      if (endpoint === OPENSTACK_SERVERS) {
        return {
          count: 1,
          next: null,
          previous: null,
          results: [{ cloud: 'ovh', cloud_id: 5, region: 'GRA9' }],
        } as never;
      }
      return { count: 0, next: null, previous: null, results: [] } as never;
    });
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === FLAVORS) return { results: FLAVOR_LIST } as never;
      return { metadata: {} } as never;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it("shows a Resize button (no dropdown arrow); opening it fetches the region's flavors in a popup", async () => {
    const w = mountDetail();
    await flushPromises();
    const resize = w.findAll('button').find((b) => b.text() === 'Resize');
    expect(resize).toBeTruthy();
    expect(popupSelect()).toBeNull(); // popup closed by default

    await resize!.trigger('click');
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith(FLAVORS);
    expect(popupSelect()).not.toBeNull();
  });

  it('disables only the flavor the VM actually runs (by name, not just matching sizes) and smaller-disk ones, each with a reason', async () => {
    const w = mountDetail();
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Resize')!
      .trigger('click');
    await flushPromises();

    const options = [...popupSelect()!.querySelectorAll('option')];
    const byName = (name: string) => options.find((o) => o.textContent?.startsWith(name));

    expect(byName('b2-7')?.disabled).toBe(true);
    expect(byName('b2-7')?.textContent).toContain('(current flavor)');
    // b2-7-flex has the exact same vCPU/RAM/disk as b2-7, but it isn't what the VM runs
    expect(byName('b2-7-flex')?.disabled).toBe(false);
    expect(byName('b2-7-flex')?.textContent).not.toContain('(current flavor)');

    expect(byName('b2-15')?.disabled).toBe(false);

    expect(byName('d2-2')?.disabled).toBe(true);
    expect(byName('d2-2')?.textContent).toContain('smaller disk, unavailable');
  });

  it('picking a flavor shows the vCPU/RAM/disk comparison, then Resize POSTs { flavor_id } and closes the popup', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);
    const w = mountDetail();
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Resize')!
      .trigger('click');
    await flushPromises();

    const select = popupSelect()!;
    select.value = 'fl-2';
    select.dispatchEvent(new Event('change'));
    await flushPromises();
    expect(document.body.textContent).toContain('7168MB → 15360MB');
    expect(document.body.textContent).toContain('50GB → 100GB');

    popupButton('Resize')!.click();
    await flushPromises();

    expect(post).toHaveBeenCalledWith(`${OPENSTACK_SERVERS}1/resize/`, { flavor_id: 'fl-2' });
    expect(popupSelect()).toBeNull(); // the popup closes on success
  });

  it('Cancel sends nothing and closes the popup', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);
    const w = mountDetail();
    await flushPromises();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Resize')!
      .trigger('click');
    await flushPromises();

    const select = popupSelect()!;
    select.value = 'fl-2';
    select.dispatchEvent(new Event('change'));
    await flushPromises();

    popupButton('Cancel')!.click();
    await flushPromises();

    expect(post).not.toHaveBeenCalled();
    expect(popupSelect()).toBeNull();
  });

  it('a transient "_resizing" push shows "Resizing…" on the status pill; a plain push clears it', async () => {
    const w = mountDetail();
    await flushPromises();
    expect(w.find('.pill').text()).toBe('Active');

    const connection = useConnectionStore();
    connection.record({
      type: 'change',
      event: 'updated',
      object_type: 'virtualization.virtualmachine',
      table: VM_TABLE,
      id: 1,
      data: { _resizing: true },
    });
    await flushPromises();
    expect(w.find('.pill').text()).toBe('Resizing…');
    expect(w.find('.pill').classes()).toContain('tone-warn');
    expect(w.find('.pill .spin').exists()).toBe(true);

    vi.useFakeTimers();
    try {
      connection.record({
        type: 'change',
        event: 'updated',
        object_type: 'virtualization.virtualmachine',
        table: VM_TABLE,
        id: 1,
        data: { status: { value: 'active', label: 'Active' } },
      });
      await flushPromises();
      // the "resizing" pill clears immediately; the debounced reload follows 250ms later
      expect(w.find('.pill').text()).toBe('Active');
      await vi.advanceTimersByTimeAsync(300);
      expect(api.retrieve).toHaveBeenCalledTimes(2); // the initial load, then the live reload
    } finally {
      vi.useRealTimers();
    }
  });
});
