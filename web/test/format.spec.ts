import { describe, it, expect } from 'vitest';
import { choiceOf, columnLabel, fieldLabel, formLabel, formatUnit, pillFor } from '../src/format';

const VM = 'virtualization_virtual_machine';

describe('formatUnit', () => {
  it('shows memory (MB) in GB from 1 GB, in MB below', () => {
    expect(formatUnit(VM, 'memory', 7168)).toBe('7 GB');
    expect(formatUnit(VM, 'memory', 15360)).toBe('15 GB');
    expect(formatUnit(VM, 'memory', 1536)).toBe('1.5 GB');
    expect(formatUnit(VM, 'memory', 512)).toBe('512 MB');
  });

  it('shows disks in GB and CPUs as vCPU, accepting numeric strings', () => {
    expect(formatUnit(VM, 'disk', 50)).toBe('50 GB');
    expect(formatUnit(VM, 'vcpus', '2.00')).toBe('2 vCPU');
    expect(formatUnit('virtualization_virtual_disk', 'size', 100)).toBe('100 GB');
  });

  it('gives nothing for fields without a unit, other tables or empty values', () => {
    expect(formatUnit(VM, 'name', 'web')).toBeNull();
    expect(formatUnit('dcim_device', 'memory', 7168)).toBeNull();
    expect(formatUnit(undefined, 'memory', 7168)).toBeNull();
    expect(formatUnit(VM, 'memory', null)).toBeNull();
    expect(formatUnit(VM, 'memory', '')).toBeNull();
    expect(formatUnit(VM, 'memory', 'lots')).toBeNull();
  });
});

describe('labels', () => {
  it('calls the disk of a VM its root disk', () => {
    expect(fieldLabel(VM, 'disk')).toBe('root disk');
    expect(columnLabel(VM, 'disk')).toBe('root disk');
    expect(formLabel(VM, 'disk')).toBe('root disk (GB)');
  });

  it('adds the unit to the form label of a field, not to the others', () => {
    expect(formLabel(VM, 'memory')).toBe('memory (MB)');
    expect(formLabel('virtualization_virtual_disk', 'size')).toBe('size (GB)');
    expect(formLabel(VM, 'vcpus')).toBe('vcpus');
    expect(formLabel(VM, 'name')).toBe('name');
  });

  it('keeps the usual labels elsewhere', () => {
    expect(fieldLabel(VM, 'virtual_machine_type')).toBe('virtual machine type');
    expect(columnLabel(VM, 'virtual_machine_type')).toBe('virtual_machine_type');
    expect(fieldLabel(undefined, 'disk')).toBe('disk');
  });
});

describe('status pills', () => {
  it('colours each VM status and marks the transitional ones as in progress', () => {
    const look = (v: string) => pillFor(VM, 'status', { value: v, label: v });
    expect(look('active')).toMatchObject({ tone: 'ok', busy: false });
    expect(look('failed')).toMatchObject({ tone: 'danger', busy: false });
    expect(look('offline')).toMatchObject({ tone: 'muted', busy: false });
    expect(look('planned')).toMatchObject({ tone: 'warn', busy: true });
    expect(look('decommissioning')).toMatchObject({ tone: 'warn', busy: true });
    expect(look('something-new')).toMatchObject({ tone: 'muted', busy: false });
  });

  it('draws the Docker states, which come as bare strings', () => {
    const container = (v: string) => pillFor('plugin_docker_container', 'state', v);
    expect(container('running')).toEqual({ label: 'Running', tone: 'ok', busy: false });
    expect(container('restarting')).toEqual({ label: 'Restarting', tone: 'warn', busy: true });
    expect(container('paused')).toMatchObject({ tone: 'info', busy: false });
    expect(container('exited')).toMatchObject({ tone: 'muted', busy: false });
    expect(container('dead')).toMatchObject({ tone: 'danger', busy: false });
    expect(pillFor('plugin_docker_host', 'state', 'refreshing')).toMatchObject({ busy: true });
    expect(pillFor('plugin_docker_host', 'state', 'error')).toMatchObject({ tone: 'danger' });
    expect(pillFor('plugin_docker_network', 'state', 'creating')).toMatchObject({ busy: true });
    expect(pillFor('plugin_docker_network', 'state', 'created')).toMatchObject({ tone: 'ok' });
  });

  it('keeps the label of a serialized choice, and capitalises a bare string', () => {
    expect(pillFor(VM, 'status', { value: 'active', label: 'Active' })?.label).toBe('Active');
    expect(pillFor('plugin_docker_container', 'state', 'running')?.label).toBe('Running');
  });

  it('only draws known status fields, and nothing for an empty value', () => {
    expect(pillFor(VM, 'name', 'web')).toBeNull();
    expect(pillFor('dcim_device', 'status', 'active')).toBeNull();
    expect(pillFor('plugin_docker_container', 'status', 'Up 3 hours')).toBeNull();
    expect(pillFor(undefined, 'status', 'active')).toBeNull();
    expect(pillFor(VM, 'status', null)).toBeNull();
    expect(pillFor(VM, 'status', '')).toBeNull();
  });

  it('reads a serialized choice', () => {
    expect(choiceOf({ value: 'active', label: 'Active' })).toEqual({
      value: 'active',
      label: 'Active',
    });
    expect(choiceOf('active')).toBeNull();
    expect(choiceOf(null)).toBeNull();
    expect(choiceOf({ id: 1 })).toBeNull();
  });
});
