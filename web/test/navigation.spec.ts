import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUiStore } from '../src/stores/ui';
import { briefTarget, DETAIL_TABLES } from '../src/views/objectDetail';
import type { Resource } from '../src/api/resources';

const res = (endpoint: string, table: string, section: string, label: string): Resource => ({
  endpoint,
  table,
  section,
  label,
  writable: true,
  order: 0,
});

const RESOURCES = [
  res('/api/dcim/regions/', 'dcim_region', 'dcim', 'Regions'),
  res('/api/dcim/sites/', 'dcim_site', 'dcim', 'Sites'),
  res('/api/dcim/devices/', 'dcim_device', 'dcim', 'Devices'),
  res('/api/dcim/racks/', 'dcim_rack', 'dcim', 'Racks'),
  res(
    '/api/virtualization/virtual-machines/',
    'virtualization_virtual_machine',
    'virtualization',
    'Virtual Machines',
  ),
  res('/api/virtualization/images/', 'virtualization_image', 'virtualization', 'Images'),
  res('/api/virtualization/ssh-keys/', 'virtualization_ssh_key', 'virtualization', 'Ssh Keys'),
  res('/api/plugins/openstack/clouds/', 'plugin_openstack_cloud', 'plugins', 'Clouds'),
  res('/api/plugins/docker/hosts/', 'plugin_docker_host', 'plugins', 'Hosts'),
  res('/api/plugins/docker/vm-ssh-keys/', 'plugin_docker_vm_ssh_key', 'plugins', 'Vm Ssh Keys'),
];

describe('sidebar', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const grouped = () => {
    const ui = useUiStore();
    ui.setResources(RESOURCES);
    return ui.grouped;
  };
  const labelsOf = (section: string) =>
    grouped()
      .find((s) => s.section === section)
      ?.groups.flatMap((g) => g.items.map((i) => i.label)) ?? [];

  it('keeps only Regions and Sites of DCIM', () => {
    expect(labelsOf('dcim').sort()).toEqual(['Regions', 'Sites']);
  });

  it('lists images and SSH keys under Virtualization, in their own groups', () => {
    const virt = grouped().find((s) => s.section === 'virtualization')!;
    const group = (label: string) =>
      virt.groups.find((g) => g.label === label)?.items.map((i) => i.label);
    expect(group('Images')).toEqual(['Images']);
    expect(group('SSH Keys')).toEqual(['Ssh Keys']);
    expect(group('Virtual Machines')).toEqual(['Virtual Machines']);
  });

  it('keeps the SSH keys found on VMs out of the menu, but known to the pages', () => {
    // shown on the SSH key and VM pages, not as a list of their own
    expect(labelsOf('docker')).toEqual(['Hosts']);
    expect(useUiStore().resources.some((r) => r.table === 'plugin_docker_vm_ssh_key')).toBe(true);
  });

  it('gives the OpenStack plugin its own top-level section', () => {
    expect(grouped().some((s) => s.section === 'openstack')).toBe(true);
    expect(labelsOf('openstack')).toEqual(['Clouds']);
  });
});

describe('links between objects (briefTarget)', () => {
  const brief = (url: string, id = 12) => ({ id, url, display: 'x' });

  it('resolves an absolute API url to the detail page of its table', () => {
    expect(
      briefTarget(brief('http://host:8000/api/virtualization/virtual-machines/12/'), RESOURCES),
    ).toEqual({
      table: 'virtualization_virtual_machine',
      id: 12,
    });
  });

  it('resolves a relative url (the Docker plugin returns those)', () => {
    expect(briefTarget(brief('/api/virtualization/virtual-machines/126/', 126), RESOURCES)).toEqual(
      {
        table: 'virtualization_virtual_machine',
        id: 126,
      },
    );
  });

  it('links an import source to its cloud and a Docker host to its detail view', () => {
    expect(briefTarget(brief('/api/plugins/openstack/clouds/3/', 3), RESOURCES)?.table).toBe(
      'plugin_openstack_cloud',
    );
    expect(briefTarget(brief('/api/plugins/docker/hosts/9/', 9), RESOURCES)?.table).toBe(
      'plugin_docker_host',
    );
  });

  it('gives no link for a table without a detail page, or for a non-brief value', () => {
    expect(briefTarget(brief('/api/dcim/racks/4/', 4), RESOURCES)).toBeNull();
    expect(briefTarget(null, RESOURCES)).toBeNull();
    expect(briefTarget('text', RESOURCES)).toBeNull();
    expect(briefTarget({ id: 1 }, RESOURCES)).toBeNull(); // no url
    expect(briefTarget(brief('/api/unknown/things/1/', 1), RESOURCES)).toBeNull();
  });

  it('has a detail page for the objects the import creates', () => {
    for (const t of [
      'virtualization_virtual_machine',
      'virtualization_cluster',
      'virtualization_image',
      'dcim_region',
      'dcim_site',
      'plugin_openstack_cloud',
      'virtualization_ssh_key', // where its VMs are managed
    ]) {
      expect(DETAIL_TABLES.has(t)).toBe(true);
    }
  });
});
