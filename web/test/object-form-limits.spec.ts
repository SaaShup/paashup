// Coverage for the Docker container memory_limit/cpu_limit UX in ObjectForm: a preset
// select (incl. "Unlimited") with a "Custom…" free-entry fallback, and client-side
// validation mirroring the agent's own resourceLimits() check (mapping.js in the agent
// repo) — a bad value is caught here instead of silently failing the fire-and-forget
// webhook to the agent later.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { api } from '../src/api/client';
import { useUiStore } from '../src/stores/ui';
import ObjectForm from '../src/components/ObjectForm.vue';

const ENDPOINT = '/api/plugins/docker/containers/';
const TABLE = 'plugin_docker_container';

// Minimal fake OpenAPI doc: just enough for formFields()/modelEndpoints() to recognise
// memory_limit/cpu_limit as plain number fields (no FK/enum machinery needed here).
const SCHEMA_DOC = {
  paths: {},
  components: {
    schemas: {
      DockerContainerRequest: {
        required: [],
        properties: {
          name: { type: 'string' },
          memory_limit: { type: 'number' },
          cpu_limit: { type: 'number' },
        },
      },
      DockerContainer: {
        properties: {
          name: { type: 'string' },
          memory_limit: { type: 'number' },
          cpu_limit: { type: 'number' },
        },
      },
    },
  },
};

function mountForm(object: Record<string, unknown> | null = null) {
  setActivePinia(createPinia());
  const ui = useUiStore();
  ui.resources = [
    {
      endpoint: ENDPOINT,
      table: TABLE,
      section: 'plugins',
      label: 'Containers',
      model: 'DockerContainer',
      writable: true,
      order: 0,
    },
  ] as never;
  return mount(ObjectForm, {
    props: { model: 'DockerContainer', endpoint: ENDPOINT, object },
    attachTo: document.body,
  });
}

/** The `.row` for one field, found by its (unique) label prefix. */
function rowFor(w: VueWrapper, field: string) {
  const row = w.findAll('.row').find((r) => r.find('label').text().startsWith(field));
  if (!row) throw new Error(`No row for field "${field}"`);
  return row;
}

describe('ObjectForm: container memory_limit/cpu_limit presets + custom entry', () => {
  beforeEach(() => {
    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('defaults both fields to the "Unlimited" preset on create, with no custom input shown', async () => {
    const w = mountForm();
    await flushPromises();
    for (const field of ['memory_limit', 'cpu_limit']) {
      const row = rowFor(w, field);
      expect((row.find('select').element as HTMLSelectElement).value).toBe('0');
      expect(row.find('select').text()).toContain('Unlimited');
      expect(row.find('input[type="number"]').exists()).toBe(false);
    }
  });

  it('choosing "Custom…" reveals a free-entry input in the field\'s native unit, with a hint', async () => {
    const w = mountForm();
    await flushPromises();
    const mem = rowFor(w, 'memory_limit');
    await mem.find('select').setValue('__custom__');
    const input = mem.find('input[type="number"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes('placeholder')).toBe('Bytes');
    expect(mem.text()).toContain('In bytes — 0 or at least 6291456 (6 MiB).');

    const cpu = rowFor(w, 'cpu_limit');
    await cpu.find('select').setValue('__custom__');
    expect(cpu.find('input[type="number"]').attributes('placeholder')).toBe('CPU cores');
    expect(cpu.text()).toContain('In CPU cores — 0 or a positive number (fractions allowed, e.g. 0.3).');
  });

  it('pre-selects the matching preset when editing, or "Custom…" with the exact value otherwise', async () => {
    const w = mountForm({ id: 5, name: 'web', memory_limit: 536870912, cpu_limit: 0.33 });
    await flushPromises();
    // 536870912 bytes === the "512 MB" preset
    expect((rowFor(w, 'memory_limit').find('select').element as HTMLSelectElement).value).toBe(
      '536870912',
    );
    expect(rowFor(w, 'memory_limit').find('input[type="number"]').exists()).toBe(false);
    // 0.33 cores matches no preset -> falls back to Custom, prefilled with the real value
    const cpuRow = rowFor(w, 'cpu_limit');
    expect((cpuRow.find('select').element as HTMLSelectElement).value).toBe('__custom__');
    expect((cpuRow.find('input[type="number"]').element as HTMLInputElement).value).toBe('0.33');
  });

  it('submits a valid custom memory_limit (integer bytes) and cpu_limit (fractional cores) as numbers', async () => {
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm();
    await flushPromises();
    await rowFor(w, 'memory_limit').find('select').setValue('__custom__');
    await rowFor(w, 'cpu_limit').find('select').setValue('__custom__');
    await rowFor(w, 'memory_limit').find('input[type="number"]').setValue('536870912');
    await rowFor(w, 'cpu_limit').find('input[type="number"]').setValue('0.486');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ memory_limit: 536870912, cpu_limit: 0.486 }),
    );
  });

  it('rejects a fractional memory_limit (bytes don\'t fraction) with an inline error, and does not submit', async () => {
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm();
    await flushPromises();
    await rowFor(w, 'memory_limit').find('select').setValue('__custom__');
    await rowFor(w, 'memory_limit').find('input[type="number"]').setValue('65849.851561');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    expect(rowFor(w, 'memory_limit').text()).toContain('whole number of bytes');
  });

  it('rejects a memory_limit under 6 MiB (6291456 bytes) with an inline error, and does not submit', async () => {
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm();
    await flushPromises();
    await rowFor(w, 'memory_limit').find('select').setValue('__custom__');
    await rowFor(w, 'memory_limit').find('input[type="number"]').setValue('1024');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    expect(rowFor(w, 'memory_limit').text()).toContain('6291456');
  });

  it('shows the error live, as soon as a bad value is typed — not only after clicking Save', async () => {
    // The HTML min="0"/step on the custom input are cosmetic: the form submits via
    // @submit.prevent, so the browser's own constraint validation never runs. This is
    // the actual (JS) check, and it must be visible before the user even tries to save.
    const w = mountForm();
    await flushPromises();
    const mem = rowFor(w, 'memory_limit');
    await mem.find('select').setValue('__custom__');
    expect(mem.find('input[type="number"]').classes()).not.toContain('invalid');
    expect(mem.text()).not.toContain('Must be');

    await mem.find('input[type="number"]').setValue('-5');
    expect(mem.find('input[type="number"]').classes()).toContain('invalid');
    expect(mem.text()).toContain('Must be 0 or a positive number.');

    await mem.find('input[type="number"]').setValue('536870912');
    expect(mem.find('input[type="number"]').classes()).not.toContain('invalid');
    expect(mem.text()).not.toContain('Must be');
  });

  it('a negative cpu_limit is rejected; 0 ("Unlimited") always passes', async () => {
    const create = vi.spyOn(api, 'create').mockResolvedValue({} as never);
    const w = mountForm();
    await flushPromises();
    await rowFor(w, 'cpu_limit').find('select').setValue('__custom__');
    await rowFor(w, 'cpu_limit').find('input[type="number"]').setValue('-1');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).not.toHaveBeenCalled();
    expect(rowFor(w, 'cpu_limit').text()).toContain('Must be 0 or a positive number.');

    await rowFor(w, 'cpu_limit').find('select').setValue('0');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(create).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ cpu_limit: 0 }));
  });
});
