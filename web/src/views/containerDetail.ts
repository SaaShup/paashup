// Presentation config + helpers for the Docker container detail page. Kept framework-free
// so it can be unit-tested without mounting a component. The data is the payload from
// GET /api/plugins/docker/containers/{id}/ (serialize.ts embeds host/image briefs and the
// nine child arrays).
import type { Obj } from '../api/client.js';

export interface CollectionColumn {
  /** Key in each row object. */
  key: string;
  label: string;
  /** Foreign-key brief column (rendered as its readable name). */
  fk?: boolean;
  /** Boolean column (rendered as ✓ / ✗). */
  bool?: boolean;
}

export interface CollectionDef {
  /** Field name in the container payload (matches serialize.ts CHILD_SPECS). */
  field: string;
  title: string;
  /** Shown in the empty state, e.g. "No port mappings". */
  empty: string;
  columns: CollectionColumn[];
}

/** The nine nested collections, in display order, with their columns. */
export const CONTAINER_COLLECTIONS: CollectionDef[] = [
  {
    field: 'env',
    title: 'Environment variables',
    empty: 'No environment variables',
    columns: [
      { key: 'var_name', label: 'Variable' },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'labels',
    title: 'Labels',
    empty: 'No labels',
    columns: [
      { key: 'key', label: 'Key' },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'mounts',
    title: 'Mount volumes',
    empty: 'No mount volumes',
    columns: [
      { key: 'source', label: 'Source' },
      { key: 'volume', label: 'Volume', fk: true },
      { key: 'read_only', label: 'Read-only', bool: true },
    ],
  },
  {
    field: 'network_settings',
    title: 'Network settings',
    empty: 'No network settings',
    columns: [{ key: 'network', label: 'Network', fk: true }],
  },
  {
    field: 'binds',
    title: 'Binds',
    empty: 'No binds',
    columns: [
      { key: 'host_path', label: 'Host path' },
      { key: 'container_path', label: 'Container path' },
      { key: 'read_only', label: 'Read-only', bool: true },
    ],
  },
  {
    field: 'log_driver_options',
    title: 'Log driver options',
    empty: 'No log driver options',
    columns: [
      { key: 'option_name', label: 'Option' },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'sysctls',
    title: 'Sysctls',
    empty: 'No sysctls',
    columns: [
      { key: 'key', label: 'Key' },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'devices',
    title: 'Devices',
    empty: 'No devices',
    columns: [
      { key: 'host_path', label: 'Host path' },
      { key: 'container_path', label: 'Container path' },
    ],
  },
  {
    field: 'ports',
    title: 'Port mappings',
    empty: 'No port mappings',
    columns: [
      { key: 'public_port', label: 'Public' },
      { key: 'private_port', label: 'Private' },
      { key: 'type', label: 'Type' },
    ],
  },
];

/** Scalar container fields shown in the detail header, in order (host/image handled apart). */
export const CONTAINER_SCALARS: { key: string; label: string }[] = [
  { key: 'state', label: 'State' },
  { key: 'status', label: 'Status' },
  { key: 'operation', label: 'Operation' },
  { key: 'restart_policy', label: 'Restart policy' },
  { key: 'hostname', label: 'Hostname' },
  { key: 'ContainerID', label: 'Container ID' },
  { key: 'cap_add', label: 'cap_add' },
  { key: 'cap_drop', label: 'cap_drop' },
  { key: 'log_driver', label: 'Log driver' },
  { key: 'pid_mode', label: 'PID mode' },
  { key: 'secOpt', label: 'secOpt' },
  { key: 'extra_hosts', label: 'Extra hosts' },
  { key: 'cmd', label: 'Command' },
];

/** Readable text for any serialized value: FK/choice objects → name/label, arrays → joined. */
export function scalarText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map((v) => scalarText(v)).join(', ') : '—';
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('label' in o) return String(o.label); // choice {value,label}
    if ('display' in o) return String(o.display); // nested brief
    if ('name' in o) return String(o.name);
    return JSON.stringify(o);
  }
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}

/** Cell text for a collection column (boolean → ✓/✗, otherwise readable text). */
export function cellText(value: unknown, col: CollectionColumn): string {
  if (col.bool)
    return value === null || value === undefined || value === '' ? '—' : value ? '✓' : '✗';
  return scalarText(value);
}

/** The rows for a collection field — always an array (missing/non-array → empty). */
export function rowsOf(container: Obj, field: string): Obj[] {
  const v = (container as Record<string, unknown>)[field];
  return Array.isArray(v) ? (v as Obj[]) : [];
}
