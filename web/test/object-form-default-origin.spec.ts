// A host's netbox_base_url ("paashup URL" in the UI, see format.ts LABELS) is prefilled on
// create with the current origin (x-default-origin), so the agent can reach paashup back —
// but when paashup is served behind a reverse-proxy path prefix (e.g. Traefik's
// PathPrefix('/datacenter'), see base.ts), the origin alone drops that prefix. The prefill
// must include it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const ENDPOINT = '/api/plugins/docker/hosts/';
const TABLE = 'plugin_docker_host';

const SCHEMA_DOC = {
  paths: {},
  components: {
    schemas: {
      DockerHostRequest: {
        required: ['endpoint', 'name'],
        properties: {
          endpoint: { type: 'string' },
          name: { type: 'string' },
          netbox_base_url: { type: 'string', 'x-default-origin': true },
        },
      },
      DockerHost: {
        properties: {
          endpoint: { type: 'string' },
          name: { type: 'string' },
          netbox_base_url: { type: 'string' },
        },
      },
    },
  },
};

/** The `.row` for one field, found by its (unique) label prefix. */
function rowFor(w: VueWrapper, field: string) {
  const row = w.findAll('.row').find((r) => r.find('label').text().startsWith(field));
  if (!row) throw new Error(`No row for field "${field}"`);
  return row;
}

/** Re-imports base.ts, the store and ObjectForm fresh, so base.ts's module-level BASE
 *  constant picks up whatever window.__PB_BASE__ this test set beforehand. */
async function mountFormFresh() {
  vi.resetModules();
  const { api } = await import('../src/api/client');
  const { useUiStore } = await import('../src/stores/ui');
  const { mount } = await import('@vue/test-utils');
  const { default: ObjectForm } = await import('../src/components/ObjectForm.vue');

  vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
  vi.spyOn(api, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });

  setActivePinia(createPinia());
  const ui = useUiStore();
  ui.resources = [
    {
      endpoint: ENDPOINT,
      table: TABLE,
      section: 'plugins',
      label: 'Docker hosts',
      model: 'DockerHost',
      writable: true,
      order: 0,
    },
  ] as never;
  return mount(ObjectForm, {
    props: { model: 'DockerHost', endpoint: ENDPOINT, object: null },
    attachTo: document.body,
  });
}

describe('ObjectForm: netbox_base_url ("paashup URL") prefill', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (window as { __PB_BASE__?: string }).__PB_BASE__;
  });

  it('prefills with the bare origin when paashup is served at the root', async () => {
    const w = await mountFormFresh();
    await flushPromises();

    const input = rowFor(w, 'paashup URL').find('input');
    expect((input.element as HTMLInputElement).value).toBe(window.location.origin);
  });

  it('prefills with the origin plus the mount-path prefix behind a reverse proxy', async () => {
    (window as { __PB_BASE__?: string }).__PB_BASE__ = '/datacenter';
    const w = await mountFormFresh();
    await flushPromises();

    const input = rowFor(w, 'paashup URL').find('input');
    expect((input.element as HTMLInputElement).value).toBe(
      `${window.location.origin}/datacenter`,
    );
  });

  it('does not override an existing value (edit mode) — only the empty-on-create prefill', async () => {
    (window as { __PB_BASE__?: string }).__PB_BASE__ = '/datacenter';
    vi.resetModules();
    const { api } = await import('../src/api/client');
    const { useUiStore } = await import('../src/stores/ui');
    const { mount } = await import('@vue/test-utils');
    const { default: ObjectForm } = await import('../src/components/ObjectForm.vue');

    vi.spyOn(api, 'schema').mockResolvedValue(SCHEMA_DOC as never);
    vi.spyOn(api, 'list').mockResolvedValue({ count: 0, next: null, previous: null, results: [] });

    setActivePinia(createPinia());
    const ui = useUiStore();
    ui.resources = [
      {
        endpoint: ENDPOINT,
        table: TABLE,
        section: 'plugins',
        label: 'Docker hosts',
        model: 'DockerHost',
        writable: true,
        order: 0,
      },
    ] as never;
    const w = mount(ObjectForm, {
      props: {
        model: 'DockerHost',
        endpoint: ENDPOINT,
        object: {
          id: 1,
          endpoint: 'tcp://host:2375',
          name: 'host1',
          netbox_base_url: 'https://existing.example.com',
        },
      },
      attachTo: document.body,
    });
    await flushPromises();

    const input = rowFor(w, 'paashup URL').find('input');
    expect((input.element as HTMLInputElement).value).toBe('https://existing.example.com');
  });
});
