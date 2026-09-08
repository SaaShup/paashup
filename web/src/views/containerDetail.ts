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
  /** Required on write. */
  required?: boolean;
  /** Numeric input (sent as a number). */
  num?: boolean;
  /** FK picker: options are this table's rows, scoped to the container's host. */
  fkTable?: string;
  /** Fixed-choice select. */
  choices?: string[];
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
      { key: 'var_name', label: 'Variable', required: true },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'labels',
    title: 'Labels',
    empty: 'No labels',
    columns: [
      { key: 'key', label: 'Key', required: true },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'mounts',
    title: 'Mount volumes',
    empty: 'No mount volumes',
    columns: [
      { key: 'source', label: 'Source', required: true },
      { key: 'volume', label: 'Volume', fk: true, fkTable: 'plugin_docker_volume', required: true },
      { key: 'read_only', label: 'Read-only', bool: true },
    ],
  },
  {
    field: 'network_settings',
    title: 'Network settings',
    empty: 'No network settings',
    columns: [
      {
        key: 'network',
        label: 'Network',
        fk: true,
        fkTable: 'plugin_docker_network',
        required: true,
      },
    ],
  },
  {
    field: 'binds',
    title: 'Binds',
    empty: 'No binds',
    columns: [
      { key: 'host_path', label: 'Host path', required: true },
      { key: 'container_path', label: 'Container path', required: true },
      { key: 'read_only', label: 'Read-only', bool: true },
    ],
  },
  {
    field: 'log_driver_options',
    title: 'Log driver options',
    empty: 'No log driver options',
    columns: [
      { key: 'option_name', label: 'Option', required: true },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'sysctls',
    title: 'Sysctls',
    empty: 'No sysctls',
    columns: [
      { key: 'key', label: 'Key', required: true },
      { key: 'value', label: 'Value' },
    ],
  },
  {
    field: 'devices',
    title: 'Devices',
    empty: 'No devices',
    columns: [
      { key: 'host_path', label: 'Host path', required: true },
      { key: 'container_path', label: 'Container path', required: true },
    ],
  },
  {
    field: 'ports',
    title: 'Port mappings',
    empty: 'No port mappings',
    columns: [
      { key: 'public_port', label: 'Public', num: true, required: true },
      { key: 'private_port', label: 'Private', num: true, required: true },
      { key: 'type', label: 'Type', choices: ['tcp', 'udp', 'sctp'] },
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

export type DraftRow = Record<string, unknown>;

/** Editable draft rows for one collection. */
export function draftRows(container: Obj, c: CollectionDef): DraftRow[] {
  return rowsOf(container, c.field).map((r) => {
    const row: DraftRow = {};
    for (const col of c.columns) {
      const v = (r as Record<string, unknown>)[col.key];
      if (col.bool) row[col.key] = !!v;
      else if (col.fk) row[col.key] = v && typeof v === 'object' ? ((v as { id?: number }).id ?? '') : (v ?? '');
      else row[col.key] = v ?? '';
    }
    return row;
  });
}

/** A fresh, empty draft row for the "+ Add" button. */
export function blankRow(c: CollectionDef): DraftRow {
  const row: DraftRow = {};
  for (const col of c.columns) row[col.key] = col.bool ? false : '';
  return row;
}

/**
 * The PATCH payload for one collection.
 */
export function collectionPayload(c: CollectionDef, drafts: DraftRow[]): Obj[] {
  const out: Obj[] = [];
  for (const r of drafts) {
    const o: Obj = {};
    let hasData = false;
    for (const col of c.columns) {
      const v = r[col.key];
      if (col.bool) {
        o[col.key] = !!v;
        continue;
      }
      if (v === '' || v === null || v === undefined) continue;
      if (col.fk || col.num) {
        o[col.key] = Number(v);
        hasData = true;
      } else {
        const s = String(v).trim();
        if (!s) continue;
        o[col.key] = s;
        hasData = true;
      }
    }
    if (hasData) out.push(o);
  }
  return out;
}

// ---- agent proxies: logs & exec ---------------------------------------------------------

export function failureText(e: unknown): string {
  const detail = (e as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (detail && typeof detail === 'object') {
    const d = (detail as { detail?: unknown }).detail;
    if (typeof d === 'string' && d) return d;
    return JSON.stringify(detail);
  }
  return String(e);
}

/**
 * Readable text for whatever the agent returns from an exec: a bare string, an object
 * with output-ish fields (`stdout`/`stderr`/`output`/`result`, joined), or anything
 * else pretty-printed as JSON.
 */
export function execOutputText(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ['stdout', 'output', 'result', 'stderr']) {
      const v = o[k];
      if (typeof v === 'string' && v !== '') parts.push(v);
      else if (Array.isArray(v) && v.length) parts.push(v.map(String).join('\n'));
    }
    if (parts.length) return parts.join('\n');
  }
  return JSON.stringify(payload, null, 2);
}
