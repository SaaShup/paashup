// A Volume's size can only grow on OpenStack (Cinder has no "shrink" API): ObjectForm must
// refuse to submit a smaller size, showing why, instead of sending a PATCH the plugin's
// 'updated' hook would just revert a moment later (see volumes.ts reconcileVolumeAttachment).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import ObjectForm from '../src/components/ObjectForm.vue';

const ENDPOINT = '/api/virtualization/virtual-disks/';
const TABLE = 'virtualization_virtual_disk';

const SCHEMA_DOC = {
  paths: {},
  components: {
    schemas: {
      VirtualDiskRequest: {
        required: ['name', 'size'],
        properties: {
          virtual_machine: {
            allOf: [{ $ref: '#/components/schemas/VirtualMachineBrief' }],
            nullable: true,
          },
          name: { type: 'string' },
          size: { type: 'integer' },
        },
      },
      VirtualDisk: {
        properties: {
          virtual_machine: {
            allOf: [{ $ref: '#/components/schemas/VirtualMachineBrief' }],
            nullable: true,
          },
          name: { type: 'string' },
          size: { type: 'integer' },
        },
      },
    },
  },
};

function mountForm(object: Record<string, unknown> | null) {
  setActivePinia(createPinia());
  const ui = useUiStore();
  ui.resources = [
    {
      endpoint: ENDPOINT,
      table: TABLE,
      section: 'virtualization',
      label: 'Volumes',
      model: 'VirtualDisk',
      writable: true,
      order: 0,
    },
  ] as never;
  return mount(ObjectForm, {
    props: { model: 'VirtualDisk', endpoint: ENDPOINT, object },
    attachTo: document.body,
  });
}

function rowFor(w: VueWrapper, field: string) {
  const row = w.findAll('.row').find((r) => r.find('label').text().startsWith(field));
  if (!row) throw new Error(`No row for field "${field}"`);
  return row;
}

describe("ObjectForm: a Volume's size can only grow", () => {
  beforeEach(() => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    vi.spyOn(api, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('typing a smaller size shows the error live and blocks the submit', async () => {
    const update = vi.spyOn(api, 'update').mockResolvedValue({} as never);
    const w = mountForm({ id: 1, name: 'disk1', size: 10, virtual_machine: null });
    await flushPromises();

    const sizeInput = rowFor(w, 'size').find('input[type="number"]');
    await sizeInput.setValue(5);
    expect(rowFor(w, 'size').text()).toContain('can only grow');

    await w.find('form').trigger('submit');
    await flushPromises();
    expect(update).not.toHaveBeenCalled();
  });

  it('growing it submits normally, with no error shown', async () => {
    const update = vi.spyOn(api, 'update').mockResolvedValue({} as never);
    const w = mountForm({ id: 1, name: 'disk1', size: 10, virtual_machine: null });
    await flushPromises();

    const sizeInput = rowFor(w, 'size').find('input[type="number"]');
    await sizeInput.setValue(20);
    expect(rowFor(w, 'size').text()).not.toContain('can only grow');

    await w.find('form').trigger('submit');
    await flushPromises();
    expect(update).toHaveBeenCalledWith(ENDPOINT, 1, expect.objectContaining({ size: 20 }));
  });

  it('on create (no object yet), any size is accepted — nothing to shrink from', async () => {
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm(null);
    await flushPromises();

    await rowFor(w, 'name').find('input').setValue('new-disk');
    await rowFor(w, 'size').find('input[type="number"]').setValue(1);
    expect(rowFor(w, 'size').text()).not.toContain('can only grow');

    await w.find('form').trigger('submit');
    await flushPromises();
    expect(create).toHaveBeenCalled();
  });
});
