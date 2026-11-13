import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import { useConnectionStore } from '../src/stores/connection';
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

describe('VM reboot (ObjectDetailView)', () => {
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

  it('shows a Reboot button with a Soft/Hard menu, for a VM backed by an OpenStack server', async () => {
    const w = mountDetail();
    await flushPromises();
    const reboot = w.findAll('button').find((b) => b.text() === 'Reboot ▾');
    expect(reboot).toBeTruthy();
    expect(w.text()).not.toContain('Soft reboot'); // menu closed by default

    await reboot!.trigger('click');
    expect(w.findAll('button').some((b) => b.text() === 'Soft reboot')).toBe(true);
    expect(w.findAll('button').some((b) => b.text() === 'Hard reboot')).toBe(true);
  });

  it('soft reboot: confirms, then POSTs {type: "soft"}; the button keeps its label throughout', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);
    const w = mountDetail();
    await flushPromises();

    await w
      .findAll('button')
      .find((b) => b.text() === 'Reboot ▾')!
      .trigger('click');
    const confirmed = w
      .findAll('button')
      .find((b) => b.text() === 'Soft reboot')!
      .trigger('click');
    answerConfirm({ ok: true, checked: false });
    await confirmed;
    await flushPromises();

    expect(post).toHaveBeenCalledWith(`${OPENSTACK_SERVERS}1/reboot/`, { type: 'soft' });
    // the visual change is on the status pill, never on the button itself
    expect(
      w
        .findAll('button')
        .find((b) => b.text().startsWith('Reboot'))!
        .text(),
    ).toBe('Reboot ▾');
  });

  it('hard reboot: cancelling the confirmation sends nothing', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);
    const w = mountDetail();
    await flushPromises();

    await w
      .findAll('button')
      .find((b) => b.text() === 'Reboot ▾')!
      .trigger('click');
    const confirmed = w
      .findAll('button')
      .find((b) => b.text() === 'Hard reboot')!
      .trigger('click');
    answerConfirm({ ok: false, checked: false });
    await confirmed;
    await flushPromises();

    expect(post).not.toHaveBeenCalled();
  });

  it('a transient "_rebooting" push shows "Rebooting…" on the status pill; a plain push clears it', async () => {
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
      data: { _rebooting: true },
    });
    await flushPromises();
    expect(w.find('.pill').text()).toBe('Rebooting…');
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
      // the "rebooting" pill clears immediately; the debounced reload follows 250ms later
      expect(w.find('.pill').text()).toBe('Active');
      await vi.advanceTimersByTimeAsync(300);
      expect(api.retrieve).toHaveBeenCalledTimes(2); // the initial load, then the live reload
    } finally {
      vi.useRealTimers();
    }
  });
});
